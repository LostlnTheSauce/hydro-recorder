using System;
using System.Diagnostics;
using System.ServiceModel;
using System.Threading;
using MadgeTech.Units;
using WCFInterop;

public static class MadgeTechProbe
{
    public static int Run()
    {
        Console.WriteLine("MadgeTech 4 live-data connection test");
        Console.WriteLine("This reads locally only; it does not upload anything.");
        if (Process.GetProcessesByName("MT").Length == 0)
        {
            Console.WriteLine("Warning: MadgeTech 4 does not appear to be open on this computer.");
        }
        Console.Write("Interop username [mt4datauser]: ");
        string username = Console.ReadLine();
        if (String.IsNullOrWhiteSpace(username)) username = "mt4datauser";
        Console.Write("Interop password: ");
        string password = ReadPassword();
        Console.WriteLine();

        var binding = new NetNamedPipeBinding(NetNamedPipeSecurityMode.Transport);
        binding.OpenTimeout = TimeSpan.FromSeconds(5);
        binding.CloseTimeout = TimeSpan.FromSeconds(5);
        binding.SendTimeout = TimeSpan.FromSeconds(10);
        binding.ReceiveTimeout = TimeSpan.FromSeconds(10);

        var address = new EndpointAddress("net.pipe://localhost/MT4Data");
        Unit fahrenheit = null;
        foreach (Unit unit in Unit.AllUnits)
        {
            if (unit.Type == UnitType.Temperature && unit.Label == "°F")
            {
                fahrenheit = unit;
                break;
            }
        }
        if (fahrenheit == null)
        {
            Console.WriteLine("Could not find MadgeTech's Fahrenheit conversion unit.");
            return 3;
        }
        ChannelFactory<IMT4RealTimeNotifierService> factory = null;
        IClientChannel client = null;
        try
        {
            factory = new ChannelFactory<IMT4RealTimeNotifierService>(binding, address);
            IMT4RealTimeNotifierService service = factory.CreateChannel();
            client = (IClientChannel)service;
            service.Authenticate(username, password);
            var serials = service.GetConnectedSerialNumbers();
            Console.WriteLine("Connected loggers: " + (serials.Count == 0 ? "none" : String.Join(", ", serials)));
            if (serials.Count == 0) return 2;

            for (int sample = 1; sample <= 3; sample++)
            {
                Console.WriteLine("Sample " + sample + " of 3:");
                foreach (string serial in serials)
                {
                    try
                    {
                        RealTimeData reading = service.RequestLatestReading(serial);
                        Console.WriteLine("  Serial " + reading.Serial + " at " + reading.TimeStamp.ToString("O"));
                        for (int channel = 0; channel < reading.ChannelValues.Count; channel++)
                        {
                            RealTimeChannelData value = reading.ChannelValues[channel];
                            if (value.Unit != null && value.Unit.Type == UnitType.Temperature)
                            {
                                double degreesFahrenheit = value.Unit.Convert(value.Value, fahrenheit, new object[0]);
                                Console.WriteLine("    Channel " + (channel + 1) + ": " + degreesFahrenheit.ToString("0.####") + " °F (" + value.Status + ")");
                            }
                            else
                            {
                                Console.WriteLine("    Channel " + (channel + 1) + ": " + value.Value.ToString("0.####") + " " + value.Unit + " (" + value.Status + ")");
                            }
                        }
                    }
                    catch (Exception error)
                    {
                        Console.WriteLine("  Serial " + serial + ": " + error.GetType().Name + " - " + error.Message);
                    }
                }
                if (sample < 3) Thread.Sleep(2000);
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.WriteLine("Connection failed: " + error.GetType().Name + " - " + error.Message);
            if (error.InnerException != null)
            {
                Console.WriteLine("Detail: " + error.InnerException.GetType().Name + " - " + error.InnerException.Message);
            }
            Console.WriteLine("Check that MadgeTech 4 is open and Interop data output and named pipes are enabled.");
            return 1;
        }
        finally
        {
            if (client != null)
            {
                try { client.Close(); }
                catch { client.Abort(); }
            }
            if (factory != null)
            {
                try { factory.Close(); }
                catch { factory.Abort(); }
            }
        }
    }

    private static string ReadPassword()
    {
        string password = "";
        ConsoleKeyInfo key;
        while ((key = Console.ReadKey(true)).Key != ConsoleKey.Enter)
        {
            if (key.Key == ConsoleKey.Backspace)
            {
                if (password.Length > 0) password = password.Substring(0, password.Length - 1);
            }
            else if (!Char.IsControl(key.KeyChar))
            {
                password += key.KeyChar;
            }
        }
        return password;
    }
}
