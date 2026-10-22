using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Collections.Generic;

namespace EnshroudedStudio
{
    public static class PatchBasis
    {
        public static string TargetId(string gameDirectory)
        {
            string full = Path.GetFullPath(gameDirectory).TrimEnd(Path.DirectorySeparatorChar).ToLowerInvariant();
            var json = new StringBuilder("\"");
            foreach (char c in full)
            {
                if (c == '\\') json.Append("\\\\"); else if (c == '"') json.Append("\\\"");
                else if (c < 32) json.Append("\\u" + ((int)c).ToString("x4")); else json.Append(c);
            }
            json.Append('"');
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(json.ToString()))).Replace("-", "").Substring(0, 20).ToLowerInvariant();
        }
        public static bool Exists(string dataRoot, string gameDirectory)
        { return File.Exists(Path.Combine(dataRoot, "patches", "targets", TargetId(gameDirectory), "state.json")); }
    }
    public sealed class PatchProgress
    {
        public string Stage, Message, Outcome;
        public string ActionCode, Reason, Operation;
        public bool Applied;
        public double Progress;
        public List<string> Warnings = new List<string>();
        public static PatchProgress Read(string file)
        {
            var doc = Json.Read(file);
            var result = new PatchProgress { Stage = Convert.ToString(doc["stage"]), Message = Convert.ToString(doc["message"]), Outcome = Convert.ToString(doc["outcome"]), Progress = Json.Number(doc["progress"]) };
            object details, warnings;
            if (doc.TryGetValue("result", out details) && details is Dictionary<string, object>)
            {
                var meta = (Dictionary<string, object>)details; object value;
                if (meta.TryGetValue("warnings", out warnings) && warnings is object[]) foreach (object warning in (object[])warnings) if (warning is string) result.Warnings.Add((string)warning);
                if (meta.TryGetValue("actionCode", out value)) result.ActionCode = value as string;
                if (meta.TryGetValue("reason", out value)) result.Reason = value as string;
                if (meta.TryGetValue("operation", out value)) result.Operation = value as string;
                if (meta.TryGetValue("applied", out value)) result.Applied = value is bool && (bool)value;
            }
            if (double.IsNaN(result.Progress) || double.IsInfinity(result.Progress) || result.Progress < 0 || result.Progress > 100 || (result.Outcome != "running" && result.Outcome != "success" && result.Outcome != "error")) throw new InvalidDataException("Ungültige Patch-Fortschrittsmeldung.");
            return result;
        }
        public static bool Succeeded(int exitCode, PatchProgress progress)
        { return exitCode == 0 && progress != null && progress.Outcome == "success" && progress.Progress == 100 && (progress.Stage == "complete" || progress.Stage == "done"); }
        public static bool UpdateSucceeded(int exitCode, PatchProgress progress)
        { return Succeeded(exitCode, progress) && progress.Operation == "update" && progress.Applied; }
    }
}
