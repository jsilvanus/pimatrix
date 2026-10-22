using System.Windows;
using PiMatrixCompanion.Services;
using PiMatrixCompanion.ViewModels;

namespace PiMatrixCompanion
{
    public partial class App : Application
    {
        private SettingsManager? _settingsManager;
        private VirtualDisplayService? _virtualDisplayService;
        private StreamingEngine? _streamingEngine;
        private ScreenCaptureService? _screenCaptureService;
        private PiMatrixClient? _piMatrixClient;
        private MainViewModel? _mainViewModel;
        private MainWindow? _mainWindow;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // Initialize Services
            _settingsManager = new SettingsManager();
            _virtualDisplayService = new VirtualDisplayService();
            _streamingEngine = new StreamingEngine();
            _screenCaptureService = new ScreenCaptureService();
            _piMatrixClient = new PiMatrixClient();

            // Initialize ViewModels
            _mainViewModel = new MainViewModel(
                _settingsManager,
                _virtualDisplayService,
                _streamingEngine,
                _screenCaptureService,
                _piMatrixClient
            );

            // Create and display MainWindow
            _mainWindow = new MainWindow(_mainViewModel);
            _mainWindow.Show();
        }

        protected override void OnExit(ExitEventArgs e)
        {
            _screenCaptureService?.Dispose();
            _streamingEngine?.Dispose();
            base.OnExit(e);
        }
    }
}
