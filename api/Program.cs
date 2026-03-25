using MawaqitDuGazole.Data;
using MawaqitDuGazole.Hubs;
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

app.Run();
