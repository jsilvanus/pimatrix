using System;
using System.IO;
using System.Text.Json;
using PiMatrixCompanion.Models;

namespace PiMatrixCompanion.Services
{
    public class SettingsManager
    {
        private static readonly string SettingsDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "PiMatrixCompanion"
        );

        private static readonly string SettingsFilePath = Path.Combine(SettingsDirectory, "settings.json");

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            WriteIndented = true
        };

        public AppSettings LoadSettings()
        {
            try
            {
                if (File.Exists(SettingsFilePath))
                {
                    string json = File.ReadAllText(SettingsFilePath);
                    var settings = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
                    if (settings != null)
                    {
                        // Ensure all 4 monitors exist
                        while (settings.Monitors.Count < 4)
                        {
                            int id = settings.Monitors.Count + 1;
                            settings.Monitors.Add(new VirtualMonitorConfig
                            {
                                Id = id,
                                Name = $"Virtual Monitor {id}",
                                IsEnabled = false,
                                StreamPath = $"companion{id}"
                            });
                        }
                        return settings;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SettingsManager] Failed to load settings: {ex.Message}");
            }

            var defaultSettings = AppSettings.CreateDefault();
            SaveSettings(defaultSettings);
            return defaultSettings;
        }

        public void SaveSettings(AppSettings settings)
        {
            try
            {
                if (!Directory.Exists(SettingsDirectory))
                {
                    Directory.CreateDirectory(SettingsDirectory);
                }

                string json = JsonSerializer.Serialize(settings, JsonOptions);
                File.WriteAllText(SettingsFilePath, json);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SettingsManager] Failed to save settings: {ex.Message}");
            }
        }
    }
}
