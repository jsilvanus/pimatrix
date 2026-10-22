using System.Windows;
using PiMatrixCompanion.ViewModels;

namespace PiMatrixCompanion.Views
{
    public partial class PreviewWindow : Window
    {
        public PreviewWindow(PreviewViewModel viewModel)
        {
            InitializeComponent();
            DataContext = viewModel;
        }

        private void CloseButton_Click(object sender, RoutedEventArgs e)
        {
            this.Hide();
        }
    }
}
