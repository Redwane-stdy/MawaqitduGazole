using Microsoft.AspNetCore.SignalR;
using MawaqitDuGazole.Services;

namespace MawaqitDuGazole.Hubs;

/// <summary>
/// SignalR hub — clients subscribe and receive live price updates
/// without having to poll manually.
/// </summary>
public class PriceHub : Hub
{
    private readonly StationService _service;

    public PriceHub(StationService service) => _service = service;

    /// <summary>
    /// Called by the client after connecting to register their session.
    /// The hub joins the connection into a group named after the session id
    /// so the background pusher can target it directly.
    /// </summary>
    public async Task Subscribe(string sessionId)
    {
        if (!Guid.TryParse(sessionId, out var guid)) return;
        await Groups.AddToGroupAsync(Context.ConnectionId, sessionId);

        // Immediately push the current best price for this session.
        var (prefs, cheapest) = await _service.GetSessionResultAsync(guid);
        if (cheapest is not null)
            await Clients.Caller.SendAsync("PriceUpdate", cheapest);
    }
}
