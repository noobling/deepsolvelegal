using Syncfusion.EJ2.DocumentEditor;

// Spike: Syncfusion Document Editor backend. Converts a real uploaded .docx to
// SFDT server-side (full Word fidelity — tables, styles, numbering) which the
// in-app markdown→SFDT converter can't reproduce. The Electron renderer points
// the DocumentEditorContainer's serviceUrl here.

// Register the server-side (DocIO) license from SYNCFUSION_LICENSE if present.
// Distinct from the renderer's VITE_SYNCFUSION_LICENSE — without a server key,
// an unlicensed DocIO build can stamp a trial watermark into converted docs.
var serverLicense = Environment.GetEnvironmentVariable("SYNCFUSION_LICENSE");
if (!string.IsNullOrWhiteSpace(serverLicense))
    Syncfusion.Licensing.SyncfusionLicenseProvider.RegisterLicense(serverLicense);

var builder = WebApplication.CreateBuilder(args);

const string CorsPolicy = "deepsolve";
builder.Services.AddCors(options =>
    options.AddPolicy(CorsPolicy, p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();
app.UseCors(CorsPolicy);

// Health check.
app.MapGet("/", () => "DeepSolve DocEditor spike server — POST a .docx to /api/documenteditor/Import");

// Import: multipart/form-data file upload -> SFDT JSON (full-fidelity).
app.MapPost("/api/documenteditor/Import", (HttpRequest request) =>
{
    var form = request.Form;
    if (form.Files.Count == 0)
        return Results.BadRequest("No file uploaded.");

    var file = form.Files[0];
    int dot = file.FileName.LastIndexOf('.');
    string ext = dot > -1 ? file.FileName[dot..].ToLowerInvariant() : ".docx";

    using var stream = new MemoryStream();
    file.CopyTo(stream);
    stream.Position = 0;

    WordDocument document = WordDocument.Load(stream, GetFormatType(ext));
    string sfdt = Newtonsoft.Json.JsonConvert.SerializeObject(document);
    document.Dispose();
    return Results.Content(sfdt, "application/json");
});

app.Run();

static FormatType GetFormatType(string ext) => ext switch
{
    ".dotx" or ".docx" or ".docm" or ".dotm" => FormatType.Docx,
    ".dot" or ".doc" => FormatType.Doc,
    ".rtf" => FormatType.Rtf,
    ".txt" => FormatType.Txt,
    ".xml" => FormatType.WordML,
    _ => FormatType.Docx
};
