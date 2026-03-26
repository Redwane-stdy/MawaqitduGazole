using System.Text.Json;
using MawaqitDuGazole.Services;

namespace MawaqitDuGazole.Logging;

/// <summary>
/// ILoggerProvider that intercepts every ILogger call from ASP.NET and
/// forwards a structured JSON line to the LogBroadcaster (→ SSE clients).
/// </summary>
public sealed class LogBroadcastProvider(LogBroadcaster broadcaster) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) =>
        new LogBroadcastLogger(broadcaster, categoryName);

    public void Dispose() { }
}

internal sealed class LogBroadcastLogger(LogBroadcaster broadcaster, string category) : ILogger
{
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel level) => level >= LogLevel.Information;

    public void Log<TState>(
        LogLevel level, EventId _, TState state,
        Exception? exception, Func<TState, Exception?, string> formatter)
    {
        if (!IsEnabled(level)) return;

        // Skip noisy ASP.NET framework internals
        if (category.StartsWith("Microsoft.AspNetCore.Hosting") ||
            category.StartsWith("Microsoft.AspNetCore.Server") ||
            category.StartsWith("Microsoft.AspNetCore.Routing") ||
            category.StartsWith("Microsoft.Extensions.Hosting"))
            return;

        var msg = formatter(state, exception);
        if (exception is not null) msg += $" — {exception.Message}";

        var entry = new
        {
            ts      = DateTime.UtcNow.ToString("HH:mm:ss"),
            channel = "API",
            level   = level switch
            {
                LogLevel.Warning  => "WARN",
                LogLevel.Error    => "ERROR",
                LogLevel.Critical => "FATAL",
                _                 => "INFO",
            },
            msg,
        };

        broadcaster.Publish(JsonSerializer.Serialize(entry));
    }
}
