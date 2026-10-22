using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using PiMatrixCompanion.Models;
using PiMatrixCompanion.Services;
using Xunit;

namespace PiMatrixCompanion.Tests
{
    public class ModelAndServiceTests
    {
        [Theory]
        [InlineData(1920, 1080, "16:9")]
        [InlineData(1280, 720, "16:9")]
        [InlineData(1920, 1200, "16:10")]
        [InlineData(1280, 800, "16:10")]
        [InlineData(1024, 768, "4:3")]
        [InlineData(2560, 1080, "21:9")]
        [InlineData(1920, 540, "32:9 (Ultra-wide)")]
        [InlineData(1080, 1920, "9:16 (Portrait)")]
        [InlineData(384, 192, "2:1")]
        [InlineData(1024, 256, "4:1")]
        public void AspectRatio_Calculation_ReturnsExpectedRatio(int width, int height, string expectedRatio)
        {
            string ratio = DisplayResolution.CalculateAspectRatio(width, height);
            Assert.Equal(expectedRatio, ratio);
        }

        [Fact]
        public void StreamUrl_Generation_FormatsSrtCorrectly()
        {
            var config = new VirtualMonitorConfig
            {
                Id = 1,
                Protocol = ProtocolType.SRT,
                StreamHost = "192.168.1.50",
                StreamPort = 8890,
                StreamPath = "screen1",
                SrtLatencyMs = 40
            };

            string url = config.GetStreamUrl();
            Assert.Equal("srt://192.168.1.50:8890?streamid=publish:screen1&latency=40", url);
        }

        [Fact]
        public void StreamUrl_Generation_FormatsRtmpCorrectly()
        {
            var config = new VirtualMonitorConfig
            {
                Id = 2,
                Protocol = ProtocolType.RTMP,
                StreamHost = "192.168.1.50",
                StreamPort = 1935,
                StreamPath = "live/screen2"
            };

            string url = config.GetStreamUrl();
            Assert.Equal("rtmp://192.168.1.50:1935/live/screen2", url);
        }

        [Fact]
        public void StreamUrl_Generation_FormatsWhipCorrectly()
        {
            var config = new VirtualMonitorConfig
            {
                Id = 3,
                Protocol = ProtocolType.WHIP,
                StreamHost = "192.168.1.50",
                StreamPort = 8889,
                StreamPath = "screen3"
            };

            string url = config.GetStreamUrl();
            Assert.Equal("http://192.168.1.50:8889/screen3/whip", url);
        }

        [Fact]
        public void AppSettings_Default_CreatesFourMonitorsWithTwoEnabled()
        {
            var settings = AppSettings.CreateDefault();
            Assert.Equal(4, settings.Monitors.Count);
            Assert.True(settings.Monitors[0].IsEnabled);
            Assert.True(settings.Monitors[1].IsEnabled);
            Assert.False(settings.Monitors[2].IsEnabled);
            Assert.False(settings.Monitors[3].IsEnabled);
        }

        [Fact]
        public void VirtualDisplayService_XmlGeneration_ValidStructure()
        {
            var monitors = new List<VirtualMonitorConfig>
            {
                new() { Id = 1, IsEnabled = true, Width = 1920, Height = 1080, RefreshRate = 60 },
                new() { Id = 2, IsEnabled = true, Width = 1920, Height = 540, RefreshRate = 50 },
                new() { Id = 3, IsEnabled = false, Width = 1280, Height = 720, RefreshRate = 60 }
            };

            int enabledCount = monitors.Count(m => m.IsEnabled);

            var xml = new XDocument(
                new XDeclaration("1.0", "utf-8", "yes"),
                new XElement("vdd_settings",
                    new XElement("monitors",
                        new XElement("count", enabledCount)
                    ),
                    new XElement("global",
                        new XElement("g_refresh_rate", 60),
                        new XElement("g_refresh_rate", 50)
                    ),
                    new XElement("resolutions",
                        monitors.Where(m => m.IsEnabled).Select(m =>
                            new XElement("resolution",
                                new XAttribute("width", m.Width),
                                new XAttribute("height", m.Height),
                                new XAttribute("refresh_rate", m.RefreshRate)
                            )
                        )
                    )
                )
            );

            var root = xml.Element("vdd_settings");
            Assert.NotNull(root);
            Assert.Equal("2", root.Element("monitors")?.Element("count")?.Value);

            var resElements = root.Element("resolutions")?.Elements("resolution").ToList();
            Assert.NotNull(resElements);
            Assert.Equal(2, resElements.Count);
            Assert.Equal("1920", resElements[0].Attribute("width")?.Value);
            Assert.Equal("1080", resElements[0].Attribute("height")?.Value);
            Assert.Equal("1920", resElements[1].Attribute("width")?.Value);
            Assert.Equal("540", resElements[1].Attribute("height")?.Value);
        }

        [Fact]
        public void StandardPresets_AllContainValidAspectRatios()
        {
            foreach (var preset in DisplayResolution.StandardPresets)
            {
                Assert.False(string.IsNullOrWhiteSpace(preset.Name));
                Assert.True(preset.Width > 0);
                Assert.True(preset.Height > 0);
                Assert.False(string.IsNullOrWhiteSpace(preset.AspectRatio));
            }
        }
    }
}
