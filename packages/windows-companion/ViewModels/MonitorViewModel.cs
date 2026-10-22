using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using PiMatrixCompanion.Common;
using PiMatrixCompanion.Models;
using PiMatrixCompanion.Services;

namespace PiMatrixCompanion.ViewModels
{
    public class MonitorViewModel : ObservableObject
    {
        private readonly IStreamingEngine _streamingEngine;
        private readonly IScreenCaptureService _captureService;
        private readonly VirtualMonitorConfig _config;

        private WriteableBitmap? _previewImage;
        private string _statusText = "Stopped";
        private Brush _tallyBrush = Brushes.Gray;
        private DisplayResolution _selectedResolution;

        public VirtualMonitorConfig Config => _config;

        public int Id => _config.Id;

        public string Name
        {
            get => _config.Name;
            set
            {
                if (_config.Name != value)
                {
                    _config.Name = value;
                    OnPropertyChanged();
                }
            }
        }

        public bool IsEnabled
        {
            get => _config.IsEnabled;
            set
            {
                if (_config.IsEnabled != value)
                {
                    _config.IsEnabled = value;
                    OnPropertyChanged();
                    UpdateTally();
                    if (!value && IsStreaming)
                    {
                        ToggleStreamingCommand.Execute(null);
                    }
                    if (value && !_captureService.IsCapturing(Id))
                    {
                        StartCapture();
                    }
                    else if (!value && _captureService.IsCapturing(Id))
                    {
                        _captureService.StopCapture(Id);
                    }
                }
            }
        }

        public int Width
        {
            get => _config.Width;
            set
            {
                if (_config.Width != value)
                {
                    _config.Width = value;
                    _config.AspectRatio = DisplayResolution.CalculateAspectRatio(value, _config.Height);
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(AspectRatio));
                    OnPropertyChanged(nameof(ResolutionSummary));
                }
            }
        }

        public int Height
        {
            get => _config.Height;
            set
            {
                if (_config.Height != value)
                {
                    _config.Height = value;
                    _config.AspectRatio = DisplayResolution.CalculateAspectRatio(_config.Width, value);
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(AspectRatio));
                    OnPropertyChanged(nameof(ResolutionSummary));
                }
            }
        }

        public int RefreshRate
        {
            get => _config.RefreshRate;
            set
            {
                if (_config.RefreshRate != value)
                {
                    _config.RefreshRate = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(ResolutionSummary));
                }
            }
        }

        public string AspectRatio => _config.AspectRatio;

        public string ResolutionSummary => $"{Width}x{Height} @ {RefreshRate}Hz ({AspectRatio})";

        public ProtocolType Protocol
        {
            get => _config.Protocol;
            set
            {
                if (_config.Protocol != value)
                {
                    _config.Protocol = value;
                    // Auto-update port based on protocol default if using standard ports
                    if (value == ProtocolType.SRT && _config.StreamPort == 1935) _config.StreamPort = 8890;
                    if (value == ProtocolType.RTMP && _config.StreamPort == 8890) _config.StreamPort = 1935;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(StreamPort));
                    OnPropertyChanged(nameof(StreamUrl));
                }
            }
        }

        public string StreamHost
        {
            get => _config.StreamHost;
            set
            {
                if (_config.StreamHost != value)
                {
                    _config.StreamHost = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(StreamUrl));
                }
            }
        }

        public int StreamPort
        {
            get => _config.StreamPort;
            set
            {
                if (_config.StreamPort != value)
                {
                    _config.StreamPort = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(StreamUrl));
                }
            }
        }

        public string StreamPath
        {
            get => _config.StreamPath;
            set
            {
                if (_config.StreamPath != value)
                {
                    _config.StreamPath = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(StreamUrl));
                }
            }
        }

        public int BitrateKbps
        {
            get => _config.BitrateKbps;
            set
            {
                if (_config.BitrateKbps != value)
                {
                    _config.BitrateKbps = value;
                    OnPropertyChanged();
                }
            }
        }

        public EncoderType Encoder
        {
            get => _config.Encoder;
            set
            {
                if (_config.Encoder != value)
                {
                    _config.Encoder = value;
                    OnPropertyChanged();
                }
            }
        }

        public string StreamUrl => _config.GetStreamUrl();

        public bool IsStreaming => _streamingEngine.IsStreaming(Id);

        public WriteableBitmap? PreviewImage
        {
            get => _previewImage;
            private set => SetProperty(ref _previewImage, value);
        }

        public string StatusText
        {
            get => _statusText;
            private set => SetProperty(ref _statusText, value);
        }

        public Brush TallyBrush
        {
            get => _tallyBrush;
            private set => SetProperty(ref _tallyBrush, value);
        }

        public double CurrentFps => _config.CurrentFps;
        public double CurrentBitrateKbps => _config.CurrentBitrateKbps;

        public ObservableCollection<DisplayResolution> AvailablePresets { get; } = new(DisplayResolution.StandardPresets);

        public DisplayResolution SelectedResolution
        {
            get => _selectedResolution;
            set
            {
                if (SetProperty(ref _selectedResolution, value) && value != null)
                {
                    Width = value.Width;
                    Height = value.Height;
                    RefreshRate = value.RefreshRate;
                }
            }
        }

        public RelayCommand ToggleStreamingCommand { get; }

        public MonitorViewModel(VirtualMonitorConfig config, IStreamingEngine streamingEngine, IScreenCaptureService captureService)
        {
            _config = config;
            _streamingEngine = streamingEngine;
            _captureService = captureService;

            _selectedResolution = AvailablePresets.FirstOrDefault(p => p.Width == config.Width && p.Height == config.Height)
                ?? new DisplayResolution("Custom", config.Width, config.Height, config.RefreshRate);

            ToggleStreamingCommand = new RelayCommand(async () => await ToggleStreamingAsync());

            UpdateTally();

            if (IsEnabled)
            {
                StartCapture();
            }
        }

        public void StartCapture()
        {
            _captureService.StartCapture(_config, (bitmap) =>
            {
                PreviewImage = bitmap;
                OnPropertyChanged(nameof(CurrentFps));
                OnPropertyChanged(nameof(CurrentBitrateKbps));
            });
        }

        public async Task ToggleStreamingAsync()
        {
            if (IsStreaming)
            {
                StatusText = "Stopping...";
                await _streamingEngine.StopStreamAsync(Id);
                StatusText = "Stopped";
            }
            else
            {
                StatusText = "Connecting...";
                bool success = await _streamingEngine.StartStreamAsync(_config);
                StatusText = success ? "Streaming" : "Error";
            }

            OnPropertyChanged(nameof(IsStreaming));
            UpdateTally();
        }

        private void UpdateTally()
        {
            if (IsStreaming)
            {
                TallyBrush = Brushes.LimeGreen; // Streaming live
            }
            else if (IsEnabled)
            {
                TallyBrush = Brushes.Orange; // Ready / Armed
            }
            else
            {
                TallyBrush = Brushes.Gray; // Disabled
            }
        }
    }
}
