using Dapper;
using Microsoft.AspNetCore.SignalR;
using MawaqitDuGazole.Data;
using MawaqitDuGazole.Hubs;
using MawaqitDuGazole.Models;

namespace MawaqitDuGazole.Services;

/// <summary>
/// Background service: every 10 minutes, re-queries the cheapest station
/// for every active session and pushes updates through SignalR.
/// </summary>
public class PricePusher : BackgroundService
{
    private readonly IHubContext<PriceHub> _hub;
    private readonly StationService _stations;
    private readonly GazoleDb _db;
    private readonly ILogger<PricePusher> _logger;

    public PricePusher(
        IHubContext<PriceHub> hub,
        StationService stations,
        GazoleDb db,
        ILogger<PricePusher> logger)
    {
        _hub = hub;
        _stations = stations;
        _db = db;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Push on startup, then every 10 minutes.
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            await PushAllAsync();
            await Task.Delay(TimeSpan.FromMinutes(10), stoppingToken);
        }
    }

    private async Task PushAllAsync()
    {
        _logger.LogInformation("[pusher] broadcasting price updates to active sessions…");

        // Only sessions active in the last 30 minutes
        const string sql = """
            SELECT id AS SessionId, fuel_type AS FuelType,
                   latitude AS Latitude, longitude AS Longitude, radius_km AS RadiusKm
            FROM user_sessions
            WHERE last_seen > NOW() - INTERVAL '30 minutes'
            """;

        using var conn = _db.Open();
        var sessions = (await conn.QueryAsync<dynamic>(sql)).ToList();

        int pushed = 0;
        foreach (var s in sessions)
        {
            try
            {
                var cheapest = await _stations.GetCheapestAsync(
                    (double)s.Latitude, (double)s.Longitude,
                    (string)s.FuelType, (int)s.RadiusKm);

                if (cheapest is null) continue;

                string groupName = ((Guid)s.SessionId).ToString();
                await _hub.Clients.Group(groupName).SendAsync("PriceUpdate", cheapest);
                pushed++;
            }
            catch (Exception ex)
            {
                string sid = s.SessionId.ToString();
                _logger.LogWarning("[pusher] failed session {id}: {err}", sid, ex.Message);
            }
        }
        _logger.LogInformation("[pusher] pushed to {n}/{total} sessions", pushed, sessions.Count);
    }
}
