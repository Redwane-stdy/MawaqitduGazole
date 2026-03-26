using System.Threading.Channels;

namespace MawaqitDuGazole.Services;

/// <summary>
/// Singleton — collects log entries from the custom logger provider and fans
/// them out to every connected SSE client via its own unbounded channel.
/// </summary>
public sealed class LogBroadcaster
{
    private readonly object _lock = new();
    private readonly List<Channel<string>> _clients = [];

    /// <summary>Publish a log line to all connected SSE clients.</summary>
    public void Publish(string line)
    {
        lock (_lock)
        {
            foreach (var ch in _clients)
                ch.Writer.TryWrite(line);
        }
    }

    /// <summary>Subscribe — returns a channel that receives future log lines.</summary>
    public Channel<string> Subscribe()
    {
        var ch = Channel.CreateUnbounded<string>(
            new UnboundedChannelOptions { SingleReader = true });
        lock (_lock) _clients.Add(ch);
        return ch;
    }

    /// <summary>Remove a client channel when the SSE connection closes.</summary>
    public void Unsubscribe(Channel<string> ch)
    {
        lock (_lock) _clients.Remove(ch);
        ch.Writer.TryComplete();
    }
}
