using System;

public static class RecordingWindowTests
{
    public static int Main()
    {
        Assert(!BridgeRunner.InRecordingWindow(99, 100, 0), "pre-start reading excluded");
        Assert(BridgeRunner.InRecordingWindow(100, 100, 0), "start boundary included");
        Assert(BridgeRunner.InRecordingWindow(110, 100, 120), "in-window reading included");
        Assert(BridgeRunner.InRecordingWindow(120, 100, 120), "stop boundary included");
        Assert(!BridgeRunner.InRecordingWindow(121, 100, 120), "post-stop reading excluded");
        Console.WriteLine("Start/Stop window checks passed.");
        return 0;
    }

    private static void Assert(bool condition, string label)
    {
        if (!condition) throw new Exception(label);
    }
}
