using System;
using System.Collections.ObjectModel;
using System.Linq;
using PiMatrixCompanion.Common;

namespace PiMatrixCompanion.ViewModels
{
    public class PreviewViewModel : ObservableObject
    {
        private bool _isAlwaysOnTop;
        private double _opacity = 0.95;
        private int _columns = 2;
        private MonitorViewModel? _selectedMonitor;

        public event Action<bool>? AlwaysOnTopChanged;

        public ObservableCollection<MonitorViewModel> Monitors { get; }

        public bool IsAlwaysOnTop
        {
            get => _isAlwaysOnTop;
            set
            {
                if (SetProperty(ref _isAlwaysOnTop, value))
                {
                    OnPropertyChanged(nameof(AlwaysOnTopStatusText));
                    AlwaysOnTopChanged?.Invoke(value);
                }
            }
        }

        public string AlwaysOnTopStatusText => _isAlwaysOnTop ? "📌 On Top: ON" : "On Top: OFF";

        public double Opacity
        {
            get => _opacity;
            set => SetProperty(ref _opacity, Math.Clamp(value, 0.2, 1.0));
        }

        public int Columns
        {
            get => _columns;
            set => SetProperty(ref _columns, value);
        }

        public MonitorViewModel? SelectedMonitor
        {
            get => _selectedMonitor;
            set => SetProperty(ref _selectedMonitor, value);
        }

        public RelayCommand ToggleAlwaysOnTopCommand { get; }
        public RelayCommand CycleLayoutCommand { get; }

        public PreviewViewModel(ObservableCollection<MonitorViewModel> monitors, bool initialAlwaysOnTop = true)
        {
            Monitors = monitors;
            _isAlwaysOnTop = initialAlwaysOnTop;

            ToggleAlwaysOnTopCommand = new RelayCommand(() => IsAlwaysOnTop = !IsAlwaysOnTop);
            CycleLayoutCommand = new RelayCommand(CycleLayout);

            UpdateColumns();
        }

        public void UpdateColumns()
        {
            int activeCount = Monitors.Count(m => m.IsEnabled);
            Columns = activeCount switch
            {
                1 => 1,
                2 => 2,
                3 or 4 => 2,
                _ => 1
            };
        }

        private void CycleLayout()
        {
            Columns = Columns == 1 ? 2 : 1;
        }
    }
}
