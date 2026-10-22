using System.Windows;
using PiMatrixCompanion.ViewModels;

namespace PiMatrixCompanion.Views
{
    public partial class PreviewWindow : Window
    {
        private readonly PreviewViewModel _viewModel;

        public PreviewWindow(PreviewViewModel viewModel)
        {
            InitializeComponent();
            _viewModel = viewModel;
            DataContext = _viewModel;

            this.Topmost = _viewModel.IsAlwaysOnTop;

            _viewModel.PropertyChanged += (s, e) =>
            {
                if (e.PropertyName == nameof(PreviewViewModel.IsAlwaysOnTop))
                {
                    this.Topmost = _viewModel.IsAlwaysOnTop;
                }
            };
        }

        private void CloseButton_Click(object sender, RoutedEventArgs e)
        {
            this.Hide();
        }
    }
}
