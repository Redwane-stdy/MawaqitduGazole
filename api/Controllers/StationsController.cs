using Microsoft.AspNetCore.Mvc;
using MawaqitDuGazole.Models;
using MawaqitDuGazole.Services;

namespace MawaqitDuGazole.Controllers;

[ApiController]
[Route("api/[controller]")]
public class StationsController : ControllerBase
{
    private readonly StationService _service;

    public StationsController(StationService service) => _service = service;

    /// <summary>
    /// POST /api/setup
    /// First-time setup: saves user preferences, returns session id + current cheapest.
    /// </summary>
    [HttpPost("/api/setup")]
    public async Task<ActionResult<SetupResponse>> Setup([FromBody] SetupRequest req)
    {
        if (!ValidFuelTypes.Contains(req.FuelType))
            return BadRequest($"Invalid fuel type. Valid: {string.Join(", ", ValidFuelTypes)}");

        var sessionId = await _service.SaveSessionAsync(req);
        var cheapest  = await _service.GetCheapestAsync(req.Latitude, req.Longitude, req.FuelType, req.RadiusKm);

        return Ok(new SetupResponse(sessionId, cheapest));
    }

    /// <summary>
    /// GET /api/cheapest?sessionId=…
    /// Returns the current cheapest station for a saved session.
    /// </summary>
    [HttpGet("/api/cheapest")]
    public async Task<ActionResult<NearbyStation>> Cheapest([FromQuery] Guid sessionId)
    {
        var (_, cheapest) = await _service.GetSessionResultAsync(sessionId);
        if (cheapest is null) return NotFound("No station found for this session.");
        return Ok(cheapest);
    }

    /// <summary>
    /// GET /api/nearby?lat=…&lng=…&fuel=…&radius=5
    /// Ad-hoc query — no session required.
    /// </summary>
    [HttpGet("/api/nearby")]
    public async Task<ActionResult<IEnumerable<NearbyStation>>> Nearby(
        [FromQuery] double lat,
        [FromQuery] double lng,
        [FromQuery] string fuel,
        [FromQuery] int radius = 5,
        [FromQuery] int limit  = 5)
    {
        if (!ValidFuelTypes.Contains(fuel))
            return BadRequest($"Invalid fuel type. Valid: {string.Join(", ", ValidFuelTypes)}");

        var stations = await _service.GetNearbyAsync(lat, lng, fuel, radius, limit);
        return Ok(stations);
    }

    /// <summary>GET /api/meta — ingestion stats for the dashboard.</summary>
    [HttpGet("/api/meta")]
    public async Task<ActionResult<MetaResponse>> Meta()
        => Ok(await _service.GetMetaAsync());

    private static readonly HashSet<string> ValidFuelTypes =
        ["Gazole", "SP95", "SP98", "E10", "E85", "GPLc"];
}
