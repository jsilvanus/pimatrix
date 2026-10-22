using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using PiMatrixCompanion.Common;
using PiMatrixCompanion.Models;

namespace PiMatrixCompanion.Services
{
    public interface IScreenCaptureService
    {
        void StartCapture(VirtualMonitorConfig monitor, Action<WriteableBitmap> onFrameCaptured);
        void StopCapture(int monitorId);
        bool IsCapturing(int monitorId);
        void SetFpsLimit(int fps);
    }

    public class ScreenCaptureService : IScreenCaptureService, IDisposable
    {
        private readonly ConcurrentDictionary<int, CancellationTokenSource> _captureTasks = new();
        private int _fpsLimit = 25;

        public void SetFpsLimit(int fps)
        {
            _fpsLimit = Math.Clamp(fps, 5, 60);
        }

        public bool IsCapturing(int monitorId) => _captureTasks.ContainsKey(monitorId);

        public void StartCapture(VirtualMonitorConfig monitor, Action<WriteableBitmap> onFrameCaptured)
        {
            if (_captureTasks.ContainsKey(monitor.Id))
            {
                StopCapture(monitor.Id);
            }

            var cts = new CancellationTokenSource();
            _captureTasks[monitor.Id] = cts;

            Task.Run(() => CaptureLoop(monitor, onFrameCaptured, cts.Token), cts.Token);
        }

        public void StopCapture(int monitorId)
        {
            if (_captureTasks.TryRemove(monitorId, out var cts))
            {
                try
                {
                    cts.Cancel();
                    cts.Dispose();
                }
                catch { }
            }
        }

        private void CaptureLoop(VirtualMonitorConfig monitor, Action<WriteableBitmap> onFrameCaptured, CancellationToken token)
        {
            int targetWidth = monitor.Width > 0 ? monitor.Width : 1920;
            int targetHeight = monitor.Height > 0 ? monitor.Height : 1080;

            // Generate/reuse a WriteableBitmap on the UI thread
            WriteableBitmap? bitmap = null;
            Application.Current.Dispatcher.Invoke(() =>
            {
                bitmap = new WriteableBitmap(
                    targetWidth,
                    targetHeight,
                    96,
                    96,
                    PixelFormats.Bgr32,
                    null
                );
            });

            if (bitmap == null) return;

            int frameIntervalMs = 1000 / _fpsLimit;
            var stopwatch = Stopwatch.StartNew();
            long frameCount = 0;
            var fpsStopwatch = Stopwatch.StartNew();

            int stride = targetWidth * 4;
            int bufferSize = stride * targetHeight;
            byte[] rawBuffer = new byte[bufferSize];

            while (!token.IsCancellationRequested)
            {
                stopwatch.Restart();

                try
                {
                    // Find matching monitor bounds from OS
                    var monitors = NativeMethods.GetAllMonitors();
                    NativeMethods.MonitorInfo? targetMonitor = null;

                    int monitorIndex = monitor.Id - 1;
                    if (monitorIndex >= 0 && monitorIndex < monitors.Count)
                    {
                        targetMonitor = monitors[monitorIndex];
                    }
                    else if (monitors.Count > 0)
                    {
                        targetMonitor = monitors[0]; // fallback to primary
                    }

                    if (targetMonitor != null)
                    {
                        bool success = CaptureScreenArea(
                            targetMonitor.Bounds.Left,
                            targetMonitor.Bounds.Top,
                            targetWidth,
                            targetHeight,
                            rawBuffer
                        );

                        if (success)
                        {
                            Application.Current.Dispatcher.BeginInvoke(new Action(() =>
                            {
                                try
                                {
                                    bitmap.Lock();
                                    Marshal.Copy(rawBuffer, 0, bitmap.BackBuffer, bufferSize);
                                    bitmap.AddDirtyRect(new Int32Rect(0, 0, targetWidth, targetHeight));
                                    bitmap.Unlock();

                                    onFrameCaptured(bitmap);
                                }
                                catch { }
                            }));

                            frameCount++;
                            if (fpsStopwatch.ElapsedMilliseconds >= 1000)
                            {
                                monitor.CurrentFps = Math.Round((double)frameCount * 1000.0 / fpsStopwatch.ElapsedMilliseconds, 1);
                                frameCount = 0;
                                fpsStopwatch.Restart();
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[ScreenCaptureService] Capture frame failed: {ex.Message}");
                }

                int elapsed = (int)stopwatch.ElapsedMilliseconds;
                int sleepTime = frameIntervalMs - elapsed;
                if (sleepTime > 0)
                {
                    Thread.Sleep(sleepTime);
                }
            }
        }

        private static bool CaptureScreenArea(int x, int y, int w, int h, byte[] outputBuffer)
        {
            IntPtr hDesktopWnd = NativeMethods.GetDesktopWindow();
            IntPtr hDesktopDC = NativeMethods.GetDC(hDesktopWnd);
            IntPtr hMemoryDC = NativeMethods.CreateCompatibleDC(hDesktopDC);
            IntPtr hBitmap = NativeMethods.CreateCompatibleBitmap(hDesktopDC, w, h);
            IntPtr hOldBitmap = NativeMethods.SelectObject(hMemoryDC, hBitmap);

            try
            {
                // BitBlt desktop content
                NativeMethods.BitBlt(
                    hMemoryDC,
                    0, 0,
                    w, h,
                    hDesktopDC,
                    x, y,
                    NativeMethods.SRCCOPY | NativeMethods.CAPTUREBLT
                );

                // Prepare BITMAPINFO for top-down 32-bit BGR bitmap
                var bi = new NativeMethods.BITMAPINFO();
                bi.bmiHeader.biSize = Marshal.SizeOf(typeof(NativeMethods.BITMAPINFOHEADER));
                bi.bmiHeader.biWidth = w;
                bi.bmiHeader.biHeight = -h; // Negative indicates top-down DIB
                bi.bmiHeader.biPlanes = 1;
                bi.bmiHeader.biBitCount = 32;
                bi.bmiHeader.biCompression = NativeMethods.BI_RGB;

                int lines = NativeMethods.GetDIBits(
                    hMemoryDC,
                    hBitmap,
                    0,
                    (uint)h,
                    outputBuffer,
                    ref bi,
                    NativeMethods.DIB_RGB_COLORS
                );

                return lines > 0;
            }
            finally
            {
                NativeMethods.SelectObject(hMemoryDC, hOldBitmap);
                NativeMethods.DeleteObject(hBitmap);
                NativeMethods.DeleteDC(hMemoryDC);
                NativeMethods.ReleaseDC(hDesktopWnd, hDesktopDC);
            }
        }

        public void Dispose()
        {
            foreach (var kvp in _captureTasks)
            {
                StopCapture(kvp.Key);
            }
        }
    }
}
