using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

// A local HTTP fixture is supplied by run-bridge-tests.cjs. Never contacts a logger or website.
public static class ClosedRunTests
{
    private static void Set(string field, object value) { typeof(BridgeRunner).GetField(field, BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, value); }
    private static T Get<T>(string field) { return (T)typeof(BridgeRunner).GetField(field, BindingFlags.Static | BindingFlags.NonPublic).GetValue(null); }
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    public static int Main(string[] args)
    {
        var power = FieldLaptopPower.Decode(1, 8, 84);
        Assert((int)power["battery_percent"] == 84 && (bool)power["on_ac"] && (bool)power["charging"], "Charging laptop");
        power = FieldLaptopPower.Decode(0, 4, 0);
        Assert((int)power["battery_percent"] == 0 && !(bool)power["on_ac"] && !(bool)power["charging"], "Zero battery is valid");
        power = FieldLaptopPower.Decode(1, 128, 255);
        Assert(power["battery_percent"] == null && !(bool)power["has_battery"], "Desktop has no battery");
        power = FieldLaptopPower.Decode(255, 255, 255);
        Assert(power["battery_percent"] == null && power["on_ac"] == null && power["charging"] == null, "Unknown values are not zero");
        Assert(!BridgeRunner.InRecordingWindow(99,100,0), "No pre-start backlog");
        Assert(BridgeRunner.InRecordingWindow(100,100,200), "Start boundary");
        Assert(BridgeRunner.InRecordingWindow(200,100,200), "Stop boundary");
        Assert(!BridgeRunner.InRecordingWindow(201,100,200), "No post-stop readings");
        Assert(Program.HasLibraries(args[1]), "Find installed MadgeTech libraries");
        Assert(!Program.HasLibraries(Path.GetTempPath()), "Reject folders without libraries");
        string temp = Path.Combine(Path.GetTempPath(), "grantg-closed-run-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        Set("AutoMode", true); Set("DataDirectory", temp);
        Set("Device", new DeviceConfig { website=args[0],device_id="aaaaaaaaaaaaaaaa",device_token="fixture-only",serial="TEST" });
        Set("Config", new BridgeConfig {serial="TEST"});
        Set("CurrentSourceId", "cccccccccccccccc");
        var records = Get<List<JournalRecord>>("AllRecords");
        records.Add(new JournalRecord {sequence=1,at=99,pipe=50});
        records.Add(new JournalRecord {sequence=2,at=100,pipe=60});
        records.Add(new JournalRecord {sequence=3,at=200,pipe=70});
        records.Add(new JournalRecord {sequence=4,at=201,pipe=80});
        Get<List<JournalRecord>>("Pending").Add(records[3]);
        Get<List<Dictionary<string,object>>>("ClosedRuns").Add(new Dictionary<string,object> {
            {"source_id","bbbbbbbbbbbbbbbb"},{"attached_at",100L},{"stopped_at",200L}
        });
        var drain = typeof(BridgeRunner).GetMethod("DrainClosedRun",BindingFlags.Static|BindingFlags.NonPublic);
        drain.Invoke(null,null); drain.Invoke(null,null); drain.Invoke(null,null);
        Assert(Get<string>("CurrentSourceId")=="cccccccccccccccc", "Old completion must not clear current recording");
        Assert(Get<List<JournalRecord>>("Pending").Count==1 && Get<List<JournalRecord>>("Pending")[0].at==201, "Current pending queue is untouched");
        string ack = Path.Combine(temp,"ack-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb.txt");
        Assert(File.ReadAllText(ack)=="3", "Closed-run acknowledgement persisted separately");
        Assert(File.Exists(ack+".complete"), "Completed catch-up does not replay forever");
        Console.WriteLine("Bridge passed: library discovery, start/stop boundaries, separate closed-run upload and acknowledgement, active queue preserved.");
        return 0;
    }
}
