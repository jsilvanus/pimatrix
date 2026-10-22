using System;

namespace PiMatrixCompanion.Models
{
    public class DisplayResolution
    {
        public string Name { get; set; } = string.Empty;
        public int Width { get; set; }
        public int Height { get; set; }
        public int RefreshRate { get; set; } = 60;
        public string AspectRatio { get; set; } = "16:9";

        public DisplayResolution() { }

        public DisplayResolution(string name, int width, int height, int refreshRate = 60)
        {
            Name = name;
            Width = width;
            Height = height;
            RefreshRate = refreshRate;
            AspectRatio = CalculateAspectRatio(width, height);
        }

        public static string CalculateAspectRatio(int width, int height)
        {
            if (width <= 0 || height <= 0) return "Custom";
            int gcd = GCD(width, height);
            int num = width / gcd;
            int den = height / gcd;

            // Normalize standard commercial aspect ratios
            if (num == 16 && den == 9) return "16:9";
            if ((num == 16 && den == 10) || (num == 8 && den == 5)) return "16:10";
            if (num == 4 && den == 3) return "4:3";
            if ((num == 21 && den == 9) || (num == 64 && den == 27) || (num == 43 && den == 18)) return "21:9";
            if (num == 32 && den == 9) return "32:9 (Ultra-wide)";
            if (num == 9 && den == 16) return "9:16 (Portrait)";

            return $"{num}:{den}";
        }

        private static int GCD(int a, int b)
        {
            while (b != 0)
            {
                int temp = b;
                b = a % b;
                a = temp;
            }
            return a;
        }

        public override string ToString() => $"{Name} ({Width}x{Height} @ {RefreshRate}Hz - {AspectRatio})";

        public static readonly DisplayResolution[] StandardPresets = new[]
        {
            // Standard 16:9
            new DisplayResolution("Full HD 1080p", 1920, 1080, 60),
            new DisplayResolution("Full HD 1080p (50Hz)", 1920, 1080, 50),
            new DisplayResolution("HD 720p", 1280, 720, 60),
            new DisplayResolution("QHD 1440p", 2560, 1440, 60),
            new DisplayResolution("4K UHD", 3840, 2160, 60),

            // Standard 16:10 & 4:3
            new DisplayResolution("WUXGA 16:10", 1920, 1200, 60),
            new DisplayResolution("WXGA 16:10", 1280, 800, 60),
            new DisplayResolution("XGA 4:3", 1024, 768, 60),
            new DisplayResolution("SXGA 5:4", 1280, 1024, 60),

            // Custom LED Wall / Matrix Formats
            new DisplayResolution("LED Banner (32:9)", 1920, 540, 60),
            new DisplayResolution("LED Strip (4:1)", 1024, 256, 60),
            new DisplayResolution("LED Wall 2.5:1", 1280, 480, 60),
            new DisplayResolution("Small Matrix Panel", 384, 192, 60),
            new DisplayResolution("Square Matrix Panel", 512, 512, 60),
            new DisplayResolution("Portrait 9:16", 1080, 1920, 60)
        };
    }
}
