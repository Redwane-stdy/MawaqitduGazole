using Dapper;
using MawaqitDuGazole.Data;
using MawaqitDuGazole.Models;

namespace MawaqitDuGazole.Services;

public class StationService
{
    private readonly GazoleDb _db;

    public StationService(GazoleDb db) => _db = db;

    /// <summary>
    /// Returns the cheapest station within <paramref name="radiusKm"/> km
    /// for the given fuel type, sorted by price then distance.
    /// </summary>
    public async Task<NearbyStation?> GetCheapestAsync(
        double lat, double lng,
        string fuelType, int radiusKm)
    {
        const string sql = """
            SELECT
                gs.id            AS StationId,
                gs.address       AS Address,
                gs.city          AS City,
                gs.postal_code   AS PostalCode,
                fp.fuel_type     AS FuelType,
                fp.price         AS Price,
                ROUND(
                    ST_Distance(gs.location, ST_SetSRID(ST_MakePoint(@lng, @lat), 4326)::geography)
                    / 1000.0, 2
                )                AS DistanceKm
            FROM fuel_prices fp
            JOIN gas_stations gs ON gs.id = fp.station_id
            WHERE
                fp.fuel_type = @fuelType
                AND ST_DWithin(
                    gs.location,
                    ST_SetSRID(ST_MakePoint(@lng, @lat), 4326)::geography,
                    @radiusM
                )
            ORDER BY fp.price ASC, DistanceKm ASC
            LIMIT 1
            """;

        using var conn = _db.Open();
        return await conn.QueryFirstOrDefaultAsync<NearbyStation>(sql, new
        {
            lat,
            lng,
            fuelType,
            radiusM = radiusKm * 1000
        });
    }

    /// <summary>Returns up to 5 cheapest stations near a point.</summary>
    public async Task<IEnumerable<NearbyStation>> GetNearbyAsync(
        double lat, double lng,
        string fuelType, int radiusKm, int limit = 5)
    {
        const string sql = """
            SELECT
                gs.id            AS StationId,
                gs.address       AS Address,
                gs.city          AS City,
                gs.postal_code   AS PostalCode,
                fp.fuel_type     AS FuelType,
                fp.price         AS Price,
                ROUND(
                    ST_Distance(gs.location, ST_SetSRID(ST_MakePoint(@lng, @lat), 4326)::geography)
                    / 1000.0, 2
                )                AS DistanceKm
            FROM fuel_prices fp
            JOIN gas_stations gs ON gs.id = fp.station_id
            WHERE
                fp.fuel_type = @fuelType
                AND ST_DWithin(
                    gs.location,
                    ST_SetSRID(ST_MakePoint(@lng, @lat), 4326)::geography,
                    @radiusM
                )
            ORDER BY fp.price ASC
            LIMIT @limit
            """;

        using var conn = _db.Open();
        return await conn.QueryAsync<NearbyStation>(sql, new
        {
            lat, lng, fuelType, radiusM = radiusKm * 1000, limit
        });
    }

    /// <summary>Persists user preferences and returns the new session id.</summary>
    public async Task<Guid> SaveSessionAsync(SetupRequest req)
    {
        const string sql = """
            INSERT INTO user_sessions (fuel_type, latitude, longitude, address, radius_km)
            VALUES (@FuelType, @Latitude, @Longitude, @Address, @RadiusKm)
            RETURNING id
            """;

        using var conn = _db.Open();
        return await conn.ExecuteScalarAsync<Guid>(sql, req);
    }

    /// <summary>Refreshes last_seen on a session.</summary>
    public async Task TouchSessionAsync(Guid sessionId)
    {
        using var conn = _db.Open();
        await conn.ExecuteAsync(
            "UPDATE user_sessions SET last_seen = NOW() WHERE id = @sessionId",
            new { sessionId });
    }

    public async Task<(SetupRequest? prefs, NearbyStation? cheapest)> GetSessionResultAsync(Guid sessionId)
    {
        using var conn = _db.Open();
        var prefs = await conn.QueryFirstOrDefaultAsync<SetupRequest>(
            "SELECT fuel_type AS FuelType, latitude AS Latitude, longitude AS Longitude, address AS Address, radius_km AS RadiusKm FROM user_sessions WHERE id = @sessionId",
            new { sessionId });

        if (prefs is null) return (null, null);

        await TouchSessionAsync(sessionId);
        var cheapest = await GetCheapestAsync(prefs.Latitude, prefs.Longitude, prefs.FuelType, prefs.RadiusKm);
        return (prefs, cheapest);
    }

    public async Task<MetaResponse> GetMetaAsync()
    {
        const string sql = """
            SELECT
                COALESCE((SELECT fetched_at FROM ingestion_log WHERE success ORDER BY id DESC LIMIT 1), NOW()) AS LastFetch,
                (SELECT COUNT(*) FROM gas_stations)::int AS StationCount,
                (SELECT COUNT(*) FROM fuel_prices)::int  AS PriceCount
            """;

        using var conn = _db.Open();
        return await conn.QueryFirstAsync<MetaResponse>(sql);
    }
}
