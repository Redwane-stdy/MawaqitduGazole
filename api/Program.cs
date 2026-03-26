using MawaqitDuGazole.Data;
using MawaqitDuGazole.Hubs;
using MawaqitDuGazole.Logging;
using MawaqitDuGazole.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddCors(opt =>
    opt.AddDefaultPolicy(p =>
        p.WithOrigins(
                "http://localhost:3000",
                "http://localhost:5173",
                "http://localhost:8080",
                "null"          // file:// origin for local dev
            )
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials()));

builder.Services.AddSingleton<GazoleDb>();
builder.Services.AddScoped<StationService>();
builder.Services.AddHostedService<PricePusher>();

// ── Log broadcaster (SSE) ──────────────────────────────────────────────────
builder.Services.AddSingleton<LogBroadcaster>();
builder.Logging.AddProvider(
    new LogBroadcastProvider(
        builder.Services.BuildServiceProvider().GetRequiredService<LogBroadcaster>()));

builder.Services.AddEndpointsApiExplorer();

var app = builder.Build();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.UseCors();
app.UseStaticFiles();       // serves /wwwroot — the frontend in dev
app.UseRouting();
app.MapControllers();
app.MapHub<PriceHub>("/hub/prices");

// Health check
app.MapGet("/health", () => Results.Ok(new { status = "ok", ts = DateTime.UtcNow }));

// ── SSE log stream ─────────────────────────────────────────────────────────
app.MapGet("/logs", async (LogBroadcaster logs, HttpContext ctx, CancellationToken ct) =>
{
    ctx.Response.Headers.Append("Content-Type", "text/event-stream");
    ctx.Response.Headers.Append("Cache-Control", "no-cache");
    ctx.Response.Headers.Append("X-Accel-Buffering", "no");
    await ctx.Response.Body.FlushAsync(ct);

    var ch = logs.Subscribe();
    try
    {
        await foreach (var line in ch.Reader.ReadAllAsync(ct))
        {
            await ctx.Response.WriteAsync($"data: {line}\n\n", ct);
            await ctx.Response.Body.FlushAsync(ct);
        }
    }
    finally
    {
        logs.Unsubscribe(ch);
    }
});

app.Run();
