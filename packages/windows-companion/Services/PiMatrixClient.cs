using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using PiMatrixCompanion.Models;

namespace PiMatrixCompanion.Services
{
    public interface IPiMatrixClient
    {
        Task<PiMatrixStatus> GetStatusAsync(string host, int port, CancellationToken cancellationToken = default);
        Task<List<string>> GetSourcesAsync(string host, int port, CancellationToken cancellationToken = default);
        Task<bool> PingAsync(string host, int port, CancellationToken cancellationToken = default);
    }

    public class PiMatrixClient : IPiMatrixClient
    {
        private readonly HttpClient _httpClient;

        public PiMatrixClient(HttpClient? httpClient = null)
        {
            _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        }

        public async Task<bool> PingAsync(string host, int port, CancellationToken cancellationToken = default)
        {
            try
            {
                string url = $"http://{host}:{port}/health";
                var response = await _httpClient.GetAsync(url, cancellationToken);
                return response.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }

        public async Task<PiMatrixStatus> GetStatusAsync(string host, int port, CancellationToken cancellationToken = default)
        {
            var status = new PiMatrixStatus
            {
                Host = host,
                Port = port,
                MultiviewUrl = $"http://{host}:{port}/multiview"
            };

            try
            {
                string url = $"http://{host}:{port}/api/v1/status";
                var response = await _httpClient.GetAsync(url, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    status.IsConnected = true;
                    string json = await response.Content.ReadAsStringAsync(cancellationToken);
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;

                    if (root.TryGetProperty("mode", out var modeProp))
                    {
                        status.Mode = modeProp.GetString() ?? "unknown";
                    }

                    if (root.TryGetProperty("version", out var verProp))
                    {
                        status.Version = verProp.GetString() ?? "unknown";
                    }

                    if (root.TryGetProperty("sources", out var sourcesProp) && sourcesProp.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in sourcesProp.EnumerateArray())
                        {
                            if (item.TryGetProperty("id", out var idProp))
                            {
                                status.ActiveSources.Add(idProp.GetString() ?? "");
                            }
                        }
                    }
                }
            }
            catch
            {
                status.IsConnected = false;
            }

            return status;
        }

        public async Task<List<string>> GetSourcesAsync(string host, int port, CancellationToken cancellationToken = default)
        {
            var list = new List<string>();
            try
            {
                string url = $"http://{host}:{port}/api/v1/sources";
                var response = await _httpClient.GetAsync(url, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    string json = await response.Content.ReadAsStringAsync(cancellationToken);
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var elem in doc.RootElement.EnumerateArray())
                        {
                            if (elem.TryGetProperty("id", out var idProp))
                            {
                                string? id = idProp.GetString();
                                if (!string.IsNullOrEmpty(id)) list.Add(id);
                            }
                        }
                    }
                }
            }
            catch
            {
                // return empty list on connection issue
            }
            return list;
        }
    }
}
