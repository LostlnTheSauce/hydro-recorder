using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.ServiceModel;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using MadgeTech.Units;
using WCFInterop;

public sealed class BridgeConfig
{
    public string endpoint { get; set; }
    public string source_id { get; set; }
    public string source_token { get; set; }
    public string serial { get; set; }
    public string slot { get; set; }
    public Dictionary<string, int> mapping { get; set; }
}

public sealed class DeviceConfig
{
    public string website { get; set; }
    public string device_id { get; set; }
    public string device_token { get; set; }
    public string serial { get; set; }
}

public sealed class JournalRecord
{
    public long sequence { get; set; }
    public long at { get; set; }
    public double? pipe { get; set; }
    public double? soil { get; set; }
    public double? ambient { get; set; }
    public double? aux { get; set; }
}

public static class Program
{
    private static string MadgeTechDirectory;
    public static int Main(string[] args)
    {
        MadgeTechDirectory = FindMadgeTechDirectory();
        if (MadgeTechDirectory == null) return 1;
        AppDomain.CurrentDomain.AssemblyResolve += ResolveMadgeTechAssembly;
        try { return BridgeRunner.Run(args); }
        catch (Exception error)
        {
            Console.WriteLine("Bridge could not start: " + error.Message);
            return 1;
        }
    }

    private static Assembly ResolveMadgeTechAssembly(object sender, ResolveEventArgs args)
    {
        string name = new AssemblyName(args.Name).Name + ".dll";
        string path = Path.Combine(MadgeTechDirectory, name);
        return File.Exists(path) ? Assembly.LoadFrom(path) : null;
    }

    public static bool HasLibraries(string directory)
    {
        return !String.IsNullOrWhiteSpace(directory)
            && File.Exists(Path.Combine(directory, "WCFInterop.dll"))
            && File.Exists(Path.Combine(directory, "DeviceComm.dll"))
            && File.Exists(Path.Combine(directory, "MTCommon.dll"));
    }

    private static string FindMadgeTechDirectory()
    {
        string savedPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "madgetech-folder.txt");
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var candidates = new List<string> {
            Environment.GetEnvironmentVariable("MADGETECH_DIR"),
            Path.Combine(local, "Apps", "MadgeTech", "MadgeTech 4"),
            Path.Combine(local, "MadgeTech", "MadgeTech 4"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "MadgeTech", "MadgeTech 4"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "MadgeTech", "MadgeTech 4")
        };
        if (File.Exists(savedPath)) candidates.Insert(1, File.ReadAllText(savedPath).Trim());
        foreach (string candidate in candidates)
            if (HasLibraries(candidate)) { Console.WriteLine("MadgeTech found: " + candidate); return candidate; }
        Console.WriteLine("One-time setup: locate MadgeTech 4 on this laptop.");
        Console.WriteLine("In File Explorer, open its installed folder and copy the address bar.");
        Console.WriteLine("The folder must contain WCFInterop.dll, DeviceComm.dll and MTCommon.dll.");
        while (true)
        {
            Console.Write("Paste the MadgeTech folder here (or press Enter to cancel): ");
            string entered = Console.ReadLine();
            if (String.IsNullOrWhiteSpace(entered)) return null;
            try {
                entered = Environment.ExpandEnvironmentVariables(entered.Trim().Trim('"'));
                if (File.Exists(entered)) entered = Path.GetDirectoryName(entered);
                if (!HasLibraries(entered)) { Console.WriteLine("Those program libraries were not found in that folder. Try the installed MadgeTech 4 folder."); continue; }
                File.WriteAllText(savedPath, entered);
                return entered;
            } catch (Exception error) { Console.WriteLine("Could not use that folder: " + error.Message); }
        }
    }
}

public static class FieldLaptopPower
{
    [DllImport("kernel32.dll")]
    private static extern uint SetThreadExecutionState(uint flags);

    public static bool KeepAwake() { return SetThreadExecutionState(0x80000001) != 0; }
    public static void ReleaseAwake() { SetThreadExecutionState(0x80000000); }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemPowerStatus
    {
        public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
        public uint BatteryLifeTime, BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);

    public static Dictionary<string, object> Decode(byte ac, byte flags, byte percent)
    {
        bool? hasBattery = flags == 255 ? (bool?)null : (flags & 128) == 0;
        return new Dictionary<string, object> {
            { "on_ac", ac <= 1 ? (object)(ac == 1) : null },
            { "has_battery", hasBattery },
            { "battery_percent", hasBattery == false || percent > 100 ? null : (object)(int)percent },
            { "charging", !hasBattery.HasValue ? null : (object)(hasBattery.Value && (flags & 8) != 0) }
        };
    }

    public static Dictionary<string, object> Read()
    {
        Dictionary<string, object> power = null;
        try {
            SystemPowerStatus status;
            if (GetSystemPowerStatus(out status)) power = Decode(status.ACLineStatus, status.BatteryFlag, status.BatteryLifePercent);
        } catch (Exception) { /* Power reporting must never interrupt temperature capture. */ }
        if (power == null) power = Decode(255, 255, 255);
        power["laptop_temp_f"] = ReadTemperatureF();
        return power;
    }

    // Windows thermal zones, in kelvin. No admin rights or extra drivers are needed.
    // Some laptops expose none; the host then shows no laptop temperature.
    private static List<System.Diagnostics.PerformanceCounter> ThermalZones;

    public static object ReadTemperatureF()
    {
        try {
            if (ThermalZones == null) {
                ThermalZones = new List<System.Diagnostics.PerformanceCounter>(); // Looked up once; missing zones are not retried.
                var category = new System.Diagnostics.PerformanceCounterCategory("Thermal Zone Information");
                foreach (string zone in category.GetInstanceNames())
                    ThermalZones.Add(new System.Diagnostics.PerformanceCounter("Thermal Zone Information", "Temperature", zone, true));
            }
            double hottest = 0;
            foreach (var zone in ThermalZones) {
                try { hottest = Math.Max(hottest, KelvinToF(zone.NextValue()) ?? 0); } catch (Exception) { }
            }
            return hottest > 0 ? (object)(int)hottest : null;
        } catch (Exception) { return null; }
    }

    // Readings outside 33-260 F are sensor placeholders, not real temperatures.
    public static double? KelvinToF(double kelvin)
    {
        double f = Math.Round((kelvin - 273.15) * 9 / 5 + 32);
        return f >= 33 && f <= 260 ? (double?)f : null;
    }
}

public static class BridgeRunner
{
    private static readonly object QueueLock = new object();
    private static readonly List<JournalRecord> Pending = new List<JournalRecord>();
    private static readonly List<JournalRecord> AllRecords = new List<JournalRecord>();
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static volatile bool Running = true;
    private static BridgeConfig Config;
    private static DeviceConfig Device;
    private static bool AutoMode;
    private static string CurrentSourceId;
    private static long CurrentAttachedAt;
    private static long CurrentStoppedAt;
    private static DateTime LastHeartbeat = DateTime.MinValue;
    private static string DataDirectory;
    private static string JournalPath;
    private static string AckPath;
    private static long LastSequence;
    private static long LastReadingAt;
    private static long LastAckSequence;
    private static string InteropUser;
    private static string InteropPassword;
    private static volatile bool LoggerReady;
    private static Mutex InstanceMutex;
    private static readonly List<Dictionary<string, object>> ClosedRuns = new List<Dictionary<string, object>>();
    private static readonly HashSet<string> CompletedRuns = new HashSet<string>();
    private static readonly Encoding Utf8 = new UTF8Encoding(false);

    public static int Run(string[] args)
    {
        AutoMode = args.Length == 0;
        if (AutoMode)
        {
            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "field-device.settings");
            if (!File.Exists(path))
            {
                Console.WriteLine("This field app has not been prepared for your logger yet. Ask for the private updated package.");
                return 2;
            }
            Device = Json.Deserialize<DeviceConfig>(File.ReadAllText(path, Utf8));
            ValidateDevice(Device);
            Config = new BridgeConfig { serial = Device.serial, mapping = new Dictionary<string, int> {
                { "pipe", 1 }, { "soil", 2 }, { "ambient", 3 }, { "aux", 4 } } };
        }
        else if (args.Length != 1 || !File.Exists(args[0]))
        {
            Console.WriteLine("Drag a field-connection JSON file onto Run-Bridge.cmd, or pass its path as an argument.");
            return 2;
        }
        else
        {
            Config = Json.Deserialize<BridgeConfig>(File.ReadAllText(args[0], Utf8));
            ValidateConfig(Config);
        }
        bool ownsMutex;
        InstanceMutex = new Mutex(true, "GrantG_MadgeTechBridge_" + (AutoMode ? Device.device_id : Config.source_id), out ownsMutex);
        if (!ownsMutex)
        {
            Console.WriteLine("This field connection is already running. Keep only one bridge window open per connection file.");
            InstanceMutex.Dispose();
            return 3;
        }
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2 for the HTTPS upload.
        DataDirectory = Environment.GetEnvironmentVariable("GRANTG_BRIDGE_DATA_DIR");
        if (String.IsNullOrWhiteSpace(DataDirectory))
            DataDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Data");
        Directory.CreateDirectory(DataDirectory);
        JournalPath = Path.Combine(DataDirectory, "journal-" + (AutoMode ? Device.device_id : Config.source_id) + ".jsonl");
        AckPath = AutoMode ? "" : Path.Combine(DataDirectory, "ack-" + Config.source_id + ".txt");
        LoadJournal();

        Console.WriteLine("MadgeTech field app | Logger " + Config.serial + (AutoMode ? " | Automatic connection" : " | Test " + Config.slot));
        Console.WriteLine("Website: " + (AutoMode ? Device.website : new Uri(Config.endpoint).GetLeftPart(UriPartial.Authority)));
        Console.WriteLine("Local backup: " + JournalPath);
        Console.WriteLine("Queued readings to send: " + Pending.Count);
        Console.WriteLine("Leave this window open while collecting. Press Ctrl+C to stop.");
        LoadInteropCredentials();
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs)
        {
            Running = false;
            eventArgs.Cancel = true;
        };

        Thread reader = new Thread(ReadLoop);
        Thread uploader = new Thread(UploadLoop);
        reader.IsBackground = true;
        uploader.IsBackground = true;
        // This request is scoped to this thread/process and lets the display sleep.
        // It does not override lid actions, manual shutdown, updates or critical battery protection.
        bool awake = FieldLaptopPower.KeepAwake();
        Console.WriteLine(awake ? "Sleep protection active. The screen can turn off; keep the lid open."
            : "Warning: sleep protection unavailable. Check Windows sleep settings before leaving.");
        try {
            reader.Start();
            uploader.Start();
            while (Running) Thread.Sleep(500);
            reader.Join(12000);
            uploader.Join(12000);
        } finally { FieldLaptopPower.ReleaseAwake(); }
        Console.WriteLine("Stopped. Any unsent readings remain in the local journal.");
        InstanceMutex.ReleaseMutex();
        InstanceMutex.Dispose();
        return 0;
    }

    private static void ValidateDevice(DeviceConfig device)
    {
        Uri site;
        if (device == null || !Uri.TryCreate(device.website, UriKind.Absolute, out site)
            || site.Scheme != Uri.UriSchemeHttps || site.UserInfo != "" || site.Query != "" || site.Fragment != ""
            || !System.Text.RegularExpressions.Regex.IsMatch(device.device_id ?? "", "^[a-f0-9]{16}$")
            || !System.Text.RegularExpressions.Regex.IsMatch(device.device_token ?? "", "^[a-f0-9]{64}$")
            || !System.Text.RegularExpressions.Regex.IsMatch(device.serial ?? "", "^[A-Za-z0-9_-]{2,40}$"))
            throw new InvalidOperationException("The private field app setup is incomplete.");
        device.website = device.website.TrimEnd('/');
    }

    private static void LoadInteropCredentials()
    {
        string path = Path.Combine(DataDirectory, "interop-credentials.bin");
        if (AutoMode && File.Exists(path))
        {
            try
            {
                byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser);
                string[] parts = Utf8.GetString(plain).Split(new[] { '\n' }, 2);
                if (parts.Length == 2)
                {
                    InteropUser = parts[0]; InteropPassword = parts[1];
                    using (var client = new MadgeTechClient(InteropUser, InteropPassword)) { }
                    Console.WriteLine("MadgeTech access restored for this Windows account.");
                    return;
                }
            }
            catch { Console.WriteLine("Saved MadgeTech access needs to be entered again."); }
        }
        Console.Write("MadgeTech Interop username [mt4datauser]: ");
        InteropUser = Console.ReadLine();
        if (String.IsNullOrWhiteSpace(InteropUser)) InteropUser = "mt4datauser";
        Console.Write("MadgeTech Interop password: ");
        InteropPassword = ReadPassword();
        Console.WriteLine();
        using (var client = new MadgeTechClient(InteropUser, InteropPassword)) { }
        if (AutoMode)
        {
            byte[] secret = ProtectedData.Protect(Utf8.GetBytes(InteropUser + "\n" + InteropPassword), null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(path, secret);
            Console.WriteLine("MadgeTech access saved privately for this Windows account.");
        }
    }

    private static void ValidateConfig(BridgeConfig config)
    {
        if (config == null || String.IsNullOrWhiteSpace(config.endpoint) || String.IsNullOrWhiteSpace(config.serial)
            || !System.Text.RegularExpressions.Regex.IsMatch(config.source_id ?? "", "^[a-f0-9]{16}$")
            || !System.Text.RegularExpressions.Regex.IsMatch(config.source_token ?? "", "^[a-f0-9]{64}$"))
            throw new InvalidOperationException("The field-connection file is incomplete.");
        if (config.slot != "A" && config.slot != "B") throw new InvalidOperationException("The connection file has an invalid test slot.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(config.serial, "^[A-Za-z0-9_-]{2,40}$"))
            throw new InvalidOperationException("The connection file has an invalid logger serial.");
        Uri endpoint;
        if (!Uri.TryCreate(config.endpoint, UriKind.Absolute, out endpoint) || endpoint.Scheme != Uri.UriSchemeHttps
            || !endpoint.AbsolutePath.EndsWith("/temperature.php", StringComparison.OrdinalIgnoreCase)
            || endpoint.Query != "?action=ingest")
            throw new InvalidOperationException("The field-connection file must use the website's HTTPS temperature receiver.");
        if (config.mapping == null || !config.mapping.ContainsKey("pipe") || !config.mapping.ContainsKey("soil")
            || !config.mapping.ContainsKey("ambient") || !config.mapping.ContainsKey("aux"))
            throw new InvalidOperationException("The field-connection file needs all four channel mappings.");
        var used = new HashSet<int>();
        foreach (int channel in config.mapping.Values)
        {
            if (channel < 1 || channel > 4 || !used.Add(channel))
                throw new InvalidOperationException("Channel mappings must use each of channels 1 through 4 once.");
        }
    }

    private static void LoadJournal()
    {
        if (!AutoMode && File.Exists(AckPath)) long.TryParse(File.ReadAllText(AckPath, Utf8).Trim(), out LastAckSequence);
        if (!File.Exists(JournalPath)) return;
        int damagedLines = 0;
        foreach (string line in File.ReadLines(JournalPath, Utf8))
        {
            if (String.IsNullOrWhiteSpace(line)) continue;
            JournalRecord record;
            try { record = Json.Deserialize<JournalRecord>(line); }
            catch { damagedLines++; continue; } // A partly written last line after power loss is left in place for inspection.
            if (record == null || record.sequence <= 0 || record.at <= 0) { damagedLines++; continue; }
            LastSequence = Math.Max(LastSequence, record.sequence);
            LastReadingAt = Math.Max(LastReadingAt, record.at);
            if (AutoMode)
            {
                if (record.at >= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 14L * 86400000L) AllRecords.Add(record);
            }
            else if (record.sequence > LastAckSequence) Pending.Add(record);
        }
        using (var file = new FileStream(JournalPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            if (file.Length > 0)
            {
                file.Seek(-1, SeekOrigin.End);
                if (file.ReadByte() != 10) File.AppendAllText(JournalPath, Environment.NewLine, Utf8);
            }
        }
        if (damagedLines > 0) Console.WriteLine("WARNING: " + damagedLines + " local journal line(s) could not be read. Keep the journal and check MadgeTech's dataset for any missing readings.");
    }

    private static void ReadLoop()
    {
        while (Running)
        {
            try
            {
                using (var client = new MadgeTechClient(InteropUser, InteropPassword))
                {
                    if (!client.HasSerial(Config.serial)) throw new InvalidOperationException("Logger " + Config.serial + " is not connected to MadgeTech 4.");
                    LoggerReady = true;
                    Console.WriteLine("Connected to MadgeTech 4. Reading every 2 seconds.");
                    while (Running)
                    {
                        JournalRecord record = client.Read(Config.serial, Config.mapping);
                        if (record != null && record.at > LastReadingAt)
                        {
                            lock (QueueLock)
                            {
                                record.sequence = ++LastSequence;
                                AppendRecord(record);
                                if (AutoMode) AllRecords.Add(record);
                                if (!AutoMode || (!String.IsNullOrEmpty(CurrentSourceId)
                                    && InRecordingWindow(record.at, CurrentAttachedAt, CurrentStoppedAt)))
                                    Pending.Add(record);
                                LastReadingAt = record.at;
                            }
                            Console.WriteLine(new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(record.at).ToLocalTime().ToString("g")
                                + "  Pipe " + Format(record.pipe) + "  Soil " + Format(record.soil)
                                + "  Ambient " + Format(record.ambient) + "  Extra " + Format(record.aux));
                        }
                        LoggerReady = LastReadingAt > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 30000;
                        Thread.Sleep(500);
                    }
                }
            }
            catch (Exception error)
            {
                LoggerReady = false;
                Console.WriteLine("MadgeTech connection waiting: " + error.Message);
                for (int i = 0; i < 10 && Running; i++) Thread.Sleep(500);
            }
        }
    }

    private static void UploadLoop()
    {
        while (Running)
        {
            if (AutoMode)
            {
                try
                {
                    if ((DateTime.UtcNow - LastHeartbeat).TotalSeconds >= 5) {
                        RefreshAssignment();
                        // One bounded catch-up batch; never holds a new recording hostage.
                        try { DrainClosedRun(); }
                        catch (Exception error) { Console.WriteLine("Earlier recording upload will retry; current recording continues: " + error.Message); }
                    }
                }
                catch (Exception error)
                {
                    Console.WriteLine("Website connection waiting; readings are saved locally: " + error.Message);
                    for (int i = 0; i < 5 && Running; i++) Thread.Sleep(1000);
                    continue;
                }
                if (String.IsNullOrEmpty(CurrentSourceId)) { Thread.Sleep(1000); continue; }
            }
            List<JournalRecord> batch;
            lock (QueueLock) batch = Pending.GetRange(0, Math.Min(Pending.Count, 100));
            if (batch.Count == 0)
            {
                if (AutoMode && CurrentStoppedAt > 0
                    && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= CurrentStoppedAt + 10000)
                {
                    try { CompleteRecording(); }
                    catch (Exception error) { Console.WriteLine("Finishing temperature recording: " + error.Message); }
                }
                Thread.Sleep(1000);
                continue;
            }
            try
            {
                SendBatch(batch);
                lock (QueueLock)
                {
                    long acknowledged = batch[batch.Count - 1].sequence;
                    int removeCount = Pending.FindIndex(delegate(JournalRecord record) { return record.sequence > acknowledged; });
                    if (removeCount < 0) removeCount = Pending.Count;
                    if (removeCount > 0) Pending.RemoveRange(0, removeCount);
                    LastAckSequence = acknowledged;
                    string temporary = AckPath + ".tmp";
                    File.WriteAllText(temporary, acknowledged.ToString(CultureInfo.InvariantCulture), Utf8);
                    if (File.Exists(AckPath)) File.Replace(temporary, AckPath, null);
                    else File.Move(temporary, AckPath);
                }
                Console.WriteLine("Website caught up through " + batch[batch.Count - 1].at + "; queued: " + Pending.Count);
            }
            catch (Exception error)
            {
                Console.WriteLine("Website upload waiting; readings are saved locally: " + error.Message);
                if (AutoMode && error.Message.IndexOf("recording window", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    LastHeartbeat = DateTime.MinValue;
                    Thread.Sleep(500);
                    continue;
                }
                for (int i = 0; i < 10 && Running; i++) Thread.Sleep(1000);
            }
        }
    }

    private static void RefreshAssignment()
    {
        var body = new Dictionary<string, object> {
            { "device_id", Device.device_id }, { "device_token", Device.device_token },
            { "serial", Device.serial }, { "ready", LoggerReady },
            { "power", FieldLaptopPower.Read() }
        };
        Dictionary<string, object> result = PostJson(Device.website + "/temperature.php?action=device_heartbeat", body);
        LastHeartbeat = DateTime.UtcNow;
        ClosedRuns.Clear();
        var closed = result.ContainsKey("closed_runs") ? result["closed_runs"] as System.Collections.IEnumerable : null;
        if (closed != null) foreach (object run in closed) {
            var row = run as Dictionary<string, object>;
            if (row != null) ClosedRuns.Add(row);
        }
        string sourceId = result.ContainsKey("source_id") && result["source_id"] != null
            ? Convert.ToString(result["source_id"]) : "";
        long stoppedAt = result.ContainsKey("stopped_at") && result["stopped_at"] != null
            ? Convert.ToInt64(result["stopped_at"], CultureInfo.InvariantCulture) : 0;
        if (sourceId == CurrentSourceId && stoppedAt == CurrentStoppedAt) return;
        lock (QueueLock)
        {
            CurrentSourceId = sourceId;
            CurrentStoppedAt = stoppedAt;
            Pending.Clear();
            if (sourceId == "")
            {
                Console.WriteLine("Logger is online. On the host page, press Start recording temps when ready.");
                return;
            }
            CurrentAttachedAt = Convert.ToInt64(result["attached_at"], CultureInfo.InvariantCulture);
            AckPath = Path.Combine(DataDirectory, "ack-" + Device.device_id + "-" + sourceId + ".txt");
            LastAckSequence = 0;
            if (File.Exists(AckPath)) long.TryParse(File.ReadAllText(AckPath, Utf8).Trim(), out LastAckSequence);
            // Only the operator's Start recording click defines the website record.
            // Keep pre-start samples locally for recovery, but never upload them to this test.
            long cutoff = CurrentAttachedAt;
            foreach (JournalRecord record in AllRecords)
                if (InRecordingWindow(record.at, cutoff, stoppedAt)
                    && record.sequence > LastAckSequence) Pending.Add(record);
            Console.WriteLine((stoppedAt == 0 ? "Recording" : "Finishing") + " Test "
                + Convert.ToString(result["slot"]) + "; " + Pending.Count + " in-window readings to send.");
        }
    }

    public static bool InRecordingWindow(long sampleAt, long startedAt, long stoppedAt)
    {
        return sampleAt >= startedAt && (stoppedAt == 0 || sampleAt <= stoppedAt);
    }

    private static string RunAckPath(string sourceId)
    {
        return Path.Combine(DataDirectory, "ack-" + Device.device_id + "-" + sourceId + ".txt");
    }

    private static void SaveAck(string path, long sequence)
    {
        string temporary = path + ".tmp";
        File.WriteAllText(temporary, sequence.ToString(CultureInfo.InvariantCulture), Utf8);
        if (File.Exists(path)) File.Replace(temporary, path, null);
        else File.Move(temporary, path);
    }

    private static void DrainClosedRun()
    {
        foreach (var run in ClosedRuns) {
            string id = Convert.ToString(run["source_id"]);
            // Never use a response value as an unchecked filesystem component.
            if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-f0-9]{16}$") || id == CurrentSourceId || CompletedRuns.Contains(id)) continue;
            string ack = RunAckPath(id), done = ack + ".complete";
            if (File.Exists(done)) { CompletedRuns.Add(id); continue; }
            long start = Convert.ToInt64(run["attached_at"]), stop = Convert.ToInt64(run["stopped_at"]);
            long last = 0;
            if (File.Exists(ack)) long.TryParse(File.ReadAllText(ack, Utf8).Trim(), out last);
            var batch = new List<JournalRecord>();
            lock (QueueLock) foreach (var record in AllRecords) {
                if (record.sequence > last && InRecordingWindow(record.at, start, stop)) batch.Add(record);
                if (batch.Count == 100) break;
            }
            if (batch.Count > 0) {
                SendBatch(batch, id);
                SaveAck(ack, batch[batch.Count - 1].sequence);
                return;
            }
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < stop + 10000) continue;
            PostJson(Device.website + "/temperature.php?action=device_complete", new Dictionary<string, object> {
                { "device_id", Device.device_id }, { "device_token", Device.device_token }, { "source_id", id }
            });
            File.WriteAllText(done, "Uploaded all locally available readings in this Start/Stop window.", Utf8);
            CompletedRuns.Add(id);
        }
    }

    private static void CompleteRecording()
    {
        string sourceId = CurrentSourceId;
        var body = new Dictionary<string, object> {
            { "device_id", Device.device_id }, { "device_token", Device.device_token }, { "source_id", sourceId }
        };
        Dictionary<string, object> result = PostJson(Device.website + "/temperature.php?action=device_complete", body);
        if (result == null || !result.ContainsKey("ok") || !Convert.ToBoolean(result["ok"]))
            throw new InvalidOperationException("Website did not confirm the completed recording.");
        File.WriteAllText(RunAckPath(sourceId) + ".complete", "Uploaded all locally available readings in this Start/Stop window.", Utf8);
        CompletedRuns.Add(sourceId);
        lock (QueueLock)
        {
            if (CurrentSourceId == sourceId)
            {
                CurrentSourceId = "";
                CurrentStoppedAt = 0;
                Pending.Clear();
                LastHeartbeat = DateTime.MinValue;
            }
        }
        Console.WriteLine("Temperature recording finished. Ready for the next Start recording click.");
    }

    private static Dictionary<string, object> PostJson(string endpoint, Dictionary<string, object> body)
    {
        byte[] bytes = Utf8.GetBytes(Json.Serialize(body));
        var request = (HttpWebRequest)WebRequest.Create(endpoint);
        request.Method = "POST";
        request.ContentType = "application/json";
        request.ContentLength = bytes.Length;
        request.Timeout = 10000;
        request.ReadWriteTimeout = 10000;
        using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
        try
        {
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Utf8))
                return Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
        }
        catch (WebException error)
        {
            if (error.Response != null)
            {
                using (var response = error.Response)
                using (var reader = new StreamReader(response.GetResponseStream(), Utf8))
                {
                    string detail = reader.ReadToEnd();
                    try
                    {
                        var parsed = Json.Deserialize<Dictionary<string, object>>(detail);
                        if (parsed != null && parsed.ContainsKey("error"))
                            throw new InvalidOperationException(Convert.ToString(parsed["error"]));
                    }
                    catch (ArgumentException) { }
                    catch (InvalidOperationException) { throw; }
                    throw new InvalidOperationException("Website returned an error: " + ((HttpWebResponse)response).StatusCode);
                }
            }
            throw;
        }
    }

    private static void SendBatch(List<JournalRecord> batch, string recordingId = null)
    {
        var samples = new List<Dictionary<string, object>>();
        foreach (JournalRecord record in batch)
        {
            samples.Add(new Dictionary<string, object> {
                { "at", record.at }, { "pipe", record.pipe }, { "soil", record.soil },
                { "ambient", record.ambient }, { "aux", record.aux }
            });
        }
        var body = new Dictionary<string, object> {
            { "source_id", Config.source_id }, { "source_token", Config.source_token },
            { "serial", Config.serial }, { "samples", samples }
        };
        if (AutoMode)
        {
            body["source_id"] = recordingId ?? CurrentSourceId;
            body.Remove("source_token");
            body["device_id"] = Device.device_id;
            body["device_token"] = Device.device_token;
        }
        byte[] bytes = Utf8.GetBytes(Json.Serialize(body));
        var request = (HttpWebRequest)WebRequest.Create(AutoMode ? Device.website + "/temperature.php?action=device_ingest" : Config.endpoint);
        request.Method = "POST";
        request.ContentType = "application/json";
        request.ContentLength = bytes.Length;
        request.Timeout = 10000;
        request.ReadWriteTimeout = 10000;
        using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
        try
        {
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Utf8))
            {
                string responseBody = reader.ReadToEnd();
                var result = Json.Deserialize<Dictionary<string, object>>(responseBody);
                if (result == null || !result.ContainsKey("ok") || !Convert.ToBoolean(result["ok"]))
                    throw new InvalidOperationException("The website did not acknowledge the readings.");
                if (!result.ContainsKey("accepted") || Convert.ToInt32(result["accepted"]) != batch.Count)
                    throw new InvalidOperationException("The website acknowledged an unexpected number of readings.");
            }
        }
        catch (WebException error)
        {
            if (error.Response != null)
            {
                using (var response = error.Response)
                using (var reader = new StreamReader(response.GetResponseStream(), Utf8))
                {
                    string detail = reader.ReadToEnd();
                    try
                    {
                        var parsed = Json.Deserialize<Dictionary<string, object>>(detail);
                        if (parsed != null && parsed.ContainsKey("error"))
                            throw new InvalidOperationException(Convert.ToString(parsed["error"]));
                    }
                    catch (ArgumentException) { }
                    catch (InvalidOperationException) { throw; }
                    throw new InvalidOperationException("Website returned an error: " + ((HttpWebResponse)response).StatusCode);
                }
            }
            throw;
        }
    }

    private static void AppendRecord(JournalRecord record)
    {
        byte[] bytes = Utf8.GetBytes(Json.Serialize(record) + Environment.NewLine);
        using (var stream = new FileStream(JournalPath, FileMode.Append, FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough))
        {
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush(true);
        }
    }

    private static string Format(double? value) { return value.HasValue ? value.Value.ToString("0.0", CultureInfo.InvariantCulture) + "°F" : "—"; }

    private static string ReadPassword()
    {
        var password = new StringBuilder();
        ConsoleKeyInfo key;
        while ((key = Console.ReadKey(true)).Key != ConsoleKey.Enter)
        {
            if (key.Key == ConsoleKey.Backspace)
            {
                if (password.Length > 0) password.Length--;
            }
            else if (!Char.IsControl(key.KeyChar)) password.Append(key.KeyChar);
        }
        return password.ToString();
    }
}

public sealed class MadgeTechClient : IDisposable
{
    private readonly ChannelFactory<IMT4RealTimeNotifierService> factory;
    private readonly IMT4RealTimeNotifierService service;
    private readonly IClientChannel channel;
    private readonly Unit fahrenheit;

    public MadgeTechClient(string username, string password)
    {
        var binding = new NetNamedPipeBinding(NetNamedPipeSecurityMode.Transport);
        binding.OpenTimeout = TimeSpan.FromSeconds(5);
        binding.SendTimeout = TimeSpan.FromSeconds(5);
        binding.ReceiveTimeout = TimeSpan.FromSeconds(5);
        factory = new ChannelFactory<IMT4RealTimeNotifierService>(binding, new EndpointAddress("net.pipe://localhost/MT4Data"));
        service = factory.CreateChannel();
        channel = (IClientChannel)service;
        try { service.Authenticate(username, password); }
        catch
        {
            channel.Abort();
            factory.Abort();
            throw;
        }
        foreach (Unit unit in Unit.AllUnits)
        {
            if (unit.Type == UnitType.Temperature && unit.Label == "°F") { fahrenheit = unit; break; }
        }
        if (fahrenheit == null) throw new InvalidOperationException("MadgeTech Fahrenheit unit is unavailable.");
    }

    public bool HasSerial(string serial)
    {
        foreach (string connected in service.GetConnectedSerialNumbers())
            if (String.Equals(connected, serial, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public JournalRecord Read(string serial, Dictionary<string, int> mapping)
    {
        RealTimeData data = service.RequestLatestReading(serial);
        if (data == null) return null;
        DateTime utc = data.TimeStamp.Kind == DateTimeKind.Utc ? data.TimeStamp : data.TimeStamp.ToUniversalTime();
        long at = (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        var values = new double?[data.ChannelValues.Count];
        for (int i = 0; i < data.ChannelValues.Count; i++)
        {
            RealTimeChannelData channelValue = data.ChannelValues[i];
            if (channelValue.Status != MadgeTech.Device.ReadingStatus.OK || channelValue.Unit == null
                || channelValue.Unit.Type != UnitType.Temperature || Double.IsNaN(channelValue.Value)
                || Double.IsInfinity(channelValue.Value)) continue;
            values[i] = channelValue.Unit.Convert(channelValue.Value, fahrenheit, new object[0]);
        }
        var record = new JournalRecord { at = at };
        record.pipe = ValueAt(values, mapping["pipe"]);
        record.soil = ValueAt(values, mapping["soil"]);
        record.ambient = ValueAt(values, mapping["ambient"]);
        record.aux = ValueAt(values, mapping["aux"]);
        return record.pipe.HasValue || record.soil.HasValue || record.ambient.HasValue || record.aux.HasValue ? record : null;
    }

    private static double? ValueAt(double?[] values, int channel)
    {
        return channel >= 1 && channel <= values.Length ? values[channel - 1] : null;
    }

    public void Dispose()
    {
        try { channel.Close(); } catch { channel.Abort(); }
        try { factory.Close(); } catch { factory.Abort(); }
    }
}
