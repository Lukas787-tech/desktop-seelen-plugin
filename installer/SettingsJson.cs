using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace SeelenDesktopSurface
{
    /// <summary>A number, true, false or null, kept exactly as it was written.</summary>
    sealed class JsonRaw
    {
        public readonly string Text;

        public JsonRaw(string text)
        {
            Text = text;
        }
    }

    /// <summary>A JSON object that keeps its keys in the order they came in.</summary>
    sealed class JsonObject
    {
        public readonly List<KeyValuePair<string, object>> Members = new List<KeyValuePair<string, object>>();

        public object Get(string key)
        {
            foreach (var member in Members)
            {
                if (member.Key == key) return member.Value;
            }
            return null;
        }

        public void Set(string key, object value)
        {
            for (int i = 0; i < Members.Count; i++)
            {
                if (Members[i].Key != key) continue;
                Members[i] = new KeyValuePair<string, object>(key, value);
                return;
            }
            Members.Add(new KeyValuePair<string, object>(key, value));
        }
    }

    /// <summary>
    /// Just enough JSON to change two things in Seelen's settings.json and leave
    /// everything else in it as it was: key order, and every number's exact text.
    /// .NET Framework has no JSON reader that promises either.
    /// </summary>
    static class Json
    {
        public static object Parse(string text)
        {
            int at = 0;
            if (text.Length > 0 && text[0] == '﻿') at = 1;
            var value = ParseValue(text, ref at);
            SkipSpace(text, ref at);
            if (at != text.Length) throw new FormatException("Unexpected text after the JSON at " + at + ".");
            return value;
        }

        static void SkipSpace(string s, ref int at)
        {
            while (at < s.Length && char.IsWhiteSpace(s[at])) at++;
        }

        static void Expect(string s, ref int at, char c)
        {
            SkipSpace(s, ref at);
            if (at >= s.Length || s[at] != c) throw new FormatException("Expected '" + c + "' at " + at + ".");
            at++;
        }

        static object ParseValue(string s, ref int at)
        {
            SkipSpace(s, ref at);
            if (at >= s.Length) throw new FormatException("The JSON ends too early.");
            char c = s[at];
            if (c == '{') return ParseObject(s, ref at);
            if (c == '[') return ParseArray(s, ref at);
            if (c == '"') return ParseString(s, ref at);

            int start = at;
            while (at < s.Length && "+-.0123456789eEtrufalsn".IndexOf(s[at]) >= 0) at++;
            var token = s.Substring(start, at - start);
            double number;
            if (token == "true" || token == "false" || token == "null" ||
                (token.Length > 0 && double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out number)))
            {
                return new JsonRaw(token);
            }
            throw new FormatException("Unexpected '" + (token.Length > 0 ? token : c.ToString()) + "' at " + start + ".");
        }

        static JsonObject ParseObject(string s, ref int at)
        {
            var result = new JsonObject();
            at++;
            SkipSpace(s, ref at);
            if (at < s.Length && s[at] == '}')
            {
                at++;
                return result;
            }
            while (true)
            {
                SkipSpace(s, ref at);
                if (at >= s.Length || s[at] != '"') throw new FormatException("Expected a key at " + at + ".");
                var key = ParseString(s, ref at);
                Expect(s, ref at, ':');
                result.Members.Add(new KeyValuePair<string, object>(key, ParseValue(s, ref at)));
                SkipSpace(s, ref at);
                if (at < s.Length && s[at] == ',')
                {
                    at++;
                    continue;
                }
                Expect(s, ref at, '}');
                return result;
            }
        }

        static List<object> ParseArray(string s, ref int at)
        {
            var result = new List<object>();
            at++;
            SkipSpace(s, ref at);
            if (at < s.Length && s[at] == ']')
            {
                at++;
                return result;
            }
            while (true)
            {
                result.Add(ParseValue(s, ref at));
                SkipSpace(s, ref at);
                if (at < s.Length && s[at] == ',')
                {
                    at++;
                    continue;
                }
                Expect(s, ref at, ']');
                return result;
            }
        }

        static string ParseString(string s, ref int at)
        {
            var sb = new StringBuilder();
            at++;
            while (at < s.Length)
            {
                char c = s[at++];
                if (c == '"') return sb.ToString();
                if (c != '\\')
                {
                    sb.Append(c);
                    continue;
                }
                if (at >= s.Length) break;
                char e = s[at++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (at + 4 > s.Length) throw new FormatException("A \\u escape is cut short at " + at + ".");
                        sb.Append((char)int.Parse(s.Substring(at, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        at += 4;
                        break;
                    default:
                        throw new FormatException("Unknown escape \\" + e + " at " + at + ".");
                }
            }
            throw new FormatException("A string never ends.");
        }

        /// <summary>Two-space indented, as Seelen writes it.</summary>
        public static string Write(object value)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value, 0);
            return sb.ToString();
        }

        static void Indent(StringBuilder sb, int depth)
        {
            sb.Append('\n');
            sb.Append(' ', depth * 2);
        }

        static void WriteValue(StringBuilder sb, object value, int depth)
        {
            var obj = value as JsonObject;
            if (obj != null)
            {
                if (obj.Members.Count == 0)
                {
                    sb.Append("{}");
                    return;
                }
                sb.Append('{');
                for (int i = 0; i < obj.Members.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    Indent(sb, depth + 1);
                    WriteString(sb, obj.Members[i].Key);
                    sb.Append(": ");
                    WriteValue(sb, obj.Members[i].Value, depth + 1);
                }
                Indent(sb, depth);
                sb.Append('}');
                return;
            }

            var list = value as List<object>;
            if (list != null)
            {
                if (list.Count == 0)
                {
                    sb.Append("[]");
                    return;
                }
                sb.Append('[');
                for (int i = 0; i < list.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    Indent(sb, depth + 1);
                    WriteValue(sb, list[i], depth + 1);
                }
                Indent(sb, depth);
                sb.Append(']');
                return;
            }

            var raw = value as JsonRaw;
            if (raw != null)
            {
                sb.Append(raw.Text);
                return;
            }
            var text = value as string;
            if (text != null)
            {
                WriteString(sb, text);
                return;
            }
            if (value is bool)
            {
                sb.Append((bool)value ? "true" : "false");
                return;
            }
            if (value == null)
            {
                sb.Append("null");
                return;
            }
            throw new InvalidOperationException("Cannot write a " + value.GetType().Name + " as JSON.");
        }

        static void WriteString(StringBuilder sb, string text)
        {
            sb.Append('"');
            foreach (char c in text)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }

    /// <summary>The two things setup changes in Seelen's settings, and nothing else.</summary>
    static class SeelenSettings
    {
        /// <summary>
        /// Switches the widgets on and puts the theme right after Seelen's default
        /// theme, which it paints over. Returns what it changed; empty when
        /// everything was already so.
        /// </summary>
        public static List<string> Apply(JsonObject root, IEnumerable<string> widgets, string theme, bool missingMeansEnabled)
        {
            var changes = new List<string>();

            var byWidget = root.Get("byWidget") as JsonObject;
            foreach (var id in widgets)
            {
                var entry = byWidget == null ? null : byWidget.Get(id) as JsonObject;
                var enabled = entry == null ? null : entry.Get("enabled");
                if (IsTrue(enabled) || (enabled == null && missingMeansEnabled)) continue;
                if (byWidget == null)
                {
                    byWidget = new JsonObject();
                    root.Set("byWidget", byWidget);
                }
                if (entry == null)
                {
                    entry = new JsonObject();
                    byWidget.Set(id, entry);
                }
                entry.Set("enabled", true);
                changes.Add("switched on " + id);
            }

            if (theme != null)
            {
                var themes = root.Get("activeThemes") as List<object>;
                if (themes == null)
                {
                    themes = new List<object> { "@default/theme" };
                    root.Set("activeThemes", themes);
                }
                if (!themes.Contains(theme))
                {
                    int at = themes.IndexOf("@default/theme");
                    themes.Insert(at >= 0 ? at + 1 : themes.Count, theme);
                    changes.Add("activated theme " + theme);
                }
            }
            return changes;
        }

        static bool IsTrue(object value)
        {
            var raw = value as JsonRaw;
            return (raw != null && raw.Text == "true") || (value is bool && (bool)value);
        }
    }
}
