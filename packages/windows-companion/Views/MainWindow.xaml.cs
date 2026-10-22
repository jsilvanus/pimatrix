using System;
using System.ComponentModel;
using System.Windows;
using PiMatrixCompanion.ViewModels;

namespace PiMatrixCompanion
{
    public partial class MainWindow : Window
    {
        private readonly MainViewModel _viewModel;
        private Views.PreviewWindow? _previewWindow;

        public MainWindow(MainViewModel viewModel)
        {
            InitializeComponent();
            _viewModel = viewModel;
            DataContext = _viewModel;

            _viewModel.RequestOpenPreview += OnRequestOpenPreview;

            _viewModel.PropertyChanged += (s, e) =>
            {
                if (e.PropertyName == nameof(MainViewModel.PreviewAlwaysOnTop) && _previewWindow != null)
                {
                    if (_previewWindow.DataContext is PreviewViewModel pvm)
                    {
                        pvm.IsAlwaysOnTop = _viewModel.PreviewAlwaysOnTop;
                    }
                }
            };
        }

        private void OnRequestOpenPreview()
        {
            if (_previewWindow == null || !_previewWindow.IsLoaded)
            {
                var previewVm = new PreviewViewModel(_viewModel.Monitors, _viewModel.PreviewAlwaysOnTop);
                previewVm.AlwaysOnTopChanged += (isOnTop) =>
                {
                    _viewModel.PreviewAlwaysOnTop = isOnTop;
                };
                _previewWindow = new Views.PreviewWindow(previewVm);
                _previewWindow.Closed += (s, e) => _previewWindow = null;
            }

            _previewWindow.Show();
            _previewWindow.Activate();
        }

        protected override void OnClosing(CancelEventArgs e)
        {
            _viewModel.SaveSettings();
            _previewWindow?.Close();
            base.OnClosing(e);
        }
    }
}
