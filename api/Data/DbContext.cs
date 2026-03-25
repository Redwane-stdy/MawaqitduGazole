using Npgsql;

namespace MawaqitDuGazole.Data;

public class GazoleDb
{
    private readonly string _connectionString;

    public GazoleDb(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("Default")
            ?? throw new InvalidOperationException("Missing connection string 'Default'");
    }

    public NpgsqlConnection Open()
    {
        var conn = new NpgsqlConnection(_connectionString);
        conn.Open();
        return conn;
    }
}
