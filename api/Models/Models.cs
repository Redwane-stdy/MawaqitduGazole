namespace MawaqitDuGazole.Models;

public record SetupRequest(
    string FuelType,
    double Latitude,
    double Longitude,
    string? Address,
    int RadiusKm = 5
);

public record SetupResponse(Guid SessionId, NearbyStation? Cheapest);

public record NearbyStation(
    long   StationId,
    string Address,
    string City,
    string PostalCode,
    string FuelType,
    double Price,
    double DistanceKm
);

public record MetaResponse(
    DateTime LastFetch,
    int StationCount,
    int PriceCount
);
