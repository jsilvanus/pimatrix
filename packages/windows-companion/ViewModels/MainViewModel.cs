using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using PiMatrixCompanion.Common;
using PiMatrixCompanion.Models;
using PiMatrixCompanion.Services;

namespace PiMatrixCompanion.ViewModels
{
    public class MainViewModel : ObservableObject
    {
        private readonly SettingsManager _settingsManager;
        private readonly IVirtualDisplayService _virtualDisplayService;
        private readonly IStreamingEngine _streamingEngine;
        private readonly IScreenCaptureService _screenCaptureService;
        private readonly IPiMatrixClient _piMatrixClient;

        private AppSettings _settings;
        private MonitorViewModel? _selectedMonitor;
        private PiMatrixStatus _piMatrixStatus = new();
        private bool _isDriverInstalled;
        private string _driverStatusMessage = "Checking virtual display driver...";
        private readonly DispatcherTimer _pollTimer;

        public ObservableCollection<MonitorViewModel> Monitors { get; } = new();

        public MonitorViewModel? SelectedMonitor
        {
            get => _selectedMonitor;
            set => SetProperty(ref _selectedMonitor, value);
        }

        public string PiMatrixHost
        {
            get => _settings.PiMatrixHost;
            set
            {
                if (_settings.PiMatrixHost != value)
                {
                    _settings.PiMatrixHost = value;
                    OnPropertyChanged();
                    SaveSettings();
                }
            }
        }

        public int PiMatrixApiPort
        {
            get => _settings.PiMatrixApiPort;
            set
            {
                if (_settings.PiMatrixApiPort != value)
                {
                    _settings.PiMatrixApiPort = value;
                    OnPropertyChanged();
                    SaveSettings();
                }
            }
        }

        public PiMatrixStatus PiMatrixStatus
        {
            get => _piMatrixStatus;
            private set => SetProperty(ref _piMatrixStatus, value);
        }

        public bool IsDriverInstalled
        {
            get => _isDriverInstalled;
            private set => SetProperty(ref _isDriverInstalled, value);
        }

        public string DriverStatusMessage
        {
            get => _driverStatusMessage;
            private set => SetProperty(ref _driverStatusMessage, value);
        }

        public bool PreviewAlwaysOnTop
        {
            get => _settings.PreviewAlwaysOnTop;
            set
            {
                if (_settings.PreviewAlwaysOnTop != value)
                {
                    _settings.PreviewAlwaysOnTop = value;
                    OnPropertyChanged();
                    SaveSettings();
                }
            }
        }

        public double PreviewOpacity
        {
            get => _settings.PreviewOpacity;
            set
            {
                if (Math.Abs(_settings.PreviewOpacity - value) > 0.01)
                {
                    _settings.PreviewOpacity = value;
                    OnPropertyChanged();
                    SaveSettings();
                }
            }
        }

        public RelayCommand ApplyDriverConfigCommand { get; }
        public RelayCommand RestartDriverCommand { get; }
        public RelayCommand RefreshDriverStatusCommand { get; }
        public RelayCommand ConnectPiMatrixCommand { get; }
        public RelayCommand OpenMultiviewCommand { get; }
        public RelayCommand OpenPreviewWindowCommand { get; }
        public RelayCommand StartAllStreamsCommand { get; }
        public RelayCommand StopAllStreamsCommand { get; }

        public event Action? RequestOpenPreview;

        public MainViewModel(
            SettingsManager settingsManager,
            IVirtualDisplayService virtualDisplayService,
            IStreamingEngine streamingEngine,
            IScreenCaptureService screenCaptureService,
            IPiMatrixClient piMatrixClient)
        {
            _settingsManager = settingsManager;
            _virtualDisplayService = virtualDisplayService;
            _streamingEngine = streamingEngine;
            _screenCaptureService = screenCaptureService;
            _piMatrixClient = piMatrixClient;

            _settings = _settingsManager.LoadSettings();
            _piMatrixClient.ApiKey = _settings.PiMatrixApiKey;

            // Populate Monitor ViewModels
            foreach (var monitorConfig in _settings.Monitors)
            {
                var vm = new MonitorViewModel(monitorConfig, _streamingEngine, _screenCaptureService);
                Monitors.Add(vm);
            }
            SelectedMonitor = Monitors.FirstOrDefault();

            // Initialize Commands
            ApplyDriverConfigCommand = new RelayCommand(async () => await ApplyDriverConfigAsync());
            RestartDriverCommand = new RelayCommand(async () => await RestartDriverAsync());
            RefreshDriverStatusCommand = new RelayCommand(async () => await CheckDriverStatusAsync());
            ConnectPiMatrixCommand = new RelayCommand(async () => await PollPiMatrixStatusAsync());
            OpenMultiviewCommand = new RelayCommand(OpenMultiviewInBrowser);
            OpenPreviewWindowCommand = new RelayCommand(() => RequestOpenPreview?.Invoke());
            StartAllStreamsCommand = new RelayCommand(async () => await StartAllStreamsAsync());
            StopAllStreamsCommand = new RelayCommand(async () => await StopAllStreamsAsync());

            // Initialize Polling Timer for PiMatrix connection state
            _pollTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromSeconds(5)
            };
            _pollTimer.Tick += async (s, e) => await PollPiMatrixStatusAsync();
            _pollTimer.Start();

            // Initial async checks
            _ = CheckDriverStatusAsync();
            _ = PollPiMatrixStatusAsync();
        }

        public async Task CheckDriverStatusAsync()
        {
            DriverStatusMessage = "Checking virtual display driver...";
            IsDriverInstalled = await _virtualDisplayService.CheckDriverStatusAsync();
            DriverStatusMessage = IsDriverInstalled
                ? "Virtual Display Driver is installed and active."
                : "Virtual Display Driver not detected. (Install via Assets/Driver/install-driver.ps1)";
        }

        public async Task ApplyDriverConfigAsync()
        {
            DriverStatusMessage = "Applying monitor configurations to driver...";
            var monitorConfigs = Monitors.Select(m => m.Config).ToList();
            bool success = await _virtualDisplayService.ApplyDisplayConfigurationAsync(monitorConfigs);
            DriverStatusMessage = success
                ? $"Applied settings for {monitorConfigs.Count(c => c.IsEnabled)} active virtual monitor(s)."
                : "Failed to apply settings to driver.";
            SaveSettings();
        }

        public async Task RestartDriverAsync()
        {
            DriverStatusMessage = "Restarting virtual display driver adapter...";
            bool success = await _virtualDisplayService.RestartDriverAdapterAsync();
            DriverStatusMessage = success
                ? "Virtual display adapter restarted successfully."
                : "Adapter restart failed. Administrative rights may be required.";
        }

        public async Task PollPiMatrixStatusAsync()
        {
            try
            {
                PiMatrixStatus = await _piMatrixClient.GetStatusAsync(PiMatrixHost, PiMatrixApiPort);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MainViewModel] Poll PiMatrix error: {ex.Message}");
            }
        }

        private void OpenMultiviewInBrowser()
        {
            try
            {
                string url = $"http://{PiMatrixHost}:{PiMatrixApiPort}/multiview";
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { }
        }

        public async Task StartAllStreamsAsync()
        {
            foreach (var monitor in Monitors.Where(m => m.IsEnabled && !m.IsStreaming))
            {
                await monitor.ToggleStreamingAsync();
            }
        }

        public async Task StopAllStreamsAsync()
        {
            foreach (var monitor in Monitors.Where(m => m.IsStreaming))
            {
                await monitor.ToggleStreamingAsync();
            }
        }

        public void SaveSettings()
        {
            _settings.Monitors = Monitors.Select(m => m.Config).ToList();
            _settingsManager.SaveSettings(_settings);
        }
    }
}
