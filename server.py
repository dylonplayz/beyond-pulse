"""Local app server with narrow proxies for public NASA archives and optional AI summaries."""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


APP_DIR = Path(__file__).resolve().parent
RADLAB_ENDPOINT = "https://visualization.osdr.nasa.gov/radlab/api/"
EDA_ENDPOINT = "https://visualization.osdr.nasa.gov/eda/api/"
OPENAI_ENDPOINT = "https://api.openai.com/v1/responses"
AI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-6.1-terra")


def iso_utc(raw: str) -> datetime:
    value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def safe_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def safe_value(value):
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if value is None or isinstance(value, (str, int, bool)):
        return value
    return str(value)


class BeyondPulseHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        # Keep local logs concise and never print request bodies or API credentials.
        print(f"{self.log_date_time_string()} {self.address_string()} {format % args}")

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.send_json(200, {
                "ok": True,
                "nasa_radlab_configured": True,
                "ai_configured": bool(os.environ.get("OPENAI_API_KEY")),
                "ai_model": AI_MODEL,
                "ai_scope": "only Maya's synthetic scenario readings explicitly selected and consented to share",
            })
            return
        if parsed.path == "/api/radlab":
            self.handle_radlab(parse_qs(parsed.query))
            return
        if parsed.path == "/api/eda/missions":
            self.handle_eda_missions()
            return
        if parsed.path == "/api/eda":
            self.handle_eda(parse_qs(parsed.query))
            return
        if parsed.path.startswith("/api/"):
            self.send_json(404, {"error": "Unknown local API route."})
            return
        super().do_GET()

    def handle_radlab(self, query):
        try:
            start_raw = query.get("start", ["2022-04-02T23:00"])[0]
            end_raw = query.get("end", ["2022-04-03T00:00"])[0]
            instrument = query.get("instrument", ["DosTel"])[0]
            if instrument != "DosTel":
                raise ValueError("Only the documented ISS DosTel archive is enabled.")
            start, end = iso_utc(start_raw), iso_utc(end_raw)
            if end <= start:
                raise ValueError("End time must be after start time.")
            if end - start > timedelta(hours=24):
                raise ValueError("Choose an archive window of 24 hours or less.")
            query_items = [
                ("spacecraft", "ISS"),
                ("instrument", instrument),
                ("timestamp>", start.strftime("%Y-%m-%dT%H:%M")),
                ("timestamp<", end.strftime("%Y-%m-%dT%H:%M")),
                ("timestamp", ""),
                ("instrument_family", ""),
                ("module", ""),
                ("absorbed_dose_rate", ""),
                ("dose_equivalent_rate", ""),
                ("flux", ""),
                ("latitude", ""),
                ("longitude", ""),
                ("altitude", ""),
                ("B", ""),
                ("L", ""),
                ("format", "json"),
            ]
            url = RADLAB_ENDPOINT + "?" + urlencode(query_items)
            request = Request(url, headers={"User-Agent": "BeyondPulse-Health-Monitoring/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            columns = payload.get("columns", [])
            raw_rows = payload.get("data", [])
            if not isinstance(columns, list) or not isinstance(raw_rows, list):
                raise ValueError("NASA RadLab returned an unexpected data format.")
            records = []
            for row in raw_rows[:5000]:
                if not isinstance(row, list):
                    continue
                records.append({name: safe_value(row[index]) for index, name in enumerate(columns) if index < len(row)})
            # Ensure the values charted by the app are consistently numeric or null.
            for record in records:
                for name in ("absorbed_dose_rate", "dose_equivalent_rate", "flux", "latitude", "longitude", "altitude", "B", "L"):
                    if name in record:
                        record[name] = safe_number(record[name])
            self.send_json(200, {
                "source": "NASA OSDR RadLab API",
                "source_url": RADLAB_ENDPOINT,
                "window_utc": f"{start.strftime('%Y-%m-%dT%H:%M:%S')} to {(end - timedelta(seconds=1)).strftime('%Y-%m-%dT%H:%M:%S')}",
                "fetched_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "unit": {"absorbed_dose_rate": "μGy/hour", "dose_equivalent_rate": "μSv/hour", "flux": "cm^-2 sr^-1 s^-1", "latitude": "deg", "longitude": "deg", "altitude": "km", "B": "nT", "L": "unitless"},
                "available_columns": columns,
                "records": records,
                "rows_returned": len(records),
                "truncated": len(raw_rows) > len(records),
                "caveat": "Historical environmental instrument measurements, not current telemetry, personal crew dose, or a medical threshold.",
            })
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except HTTPError as error:
            self.send_json(502, {"error": f"NASA RadLab returned HTTP {error.code}. Try another UTC archive window."})
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            self.send_json(502, {"error": f"NASA RadLab could not be reached: {type(error).__name__}. The bundled historical archive snapshot remains available."})
        except Exception as error:
            self.send_json(502, {"error": f"NASA RadLab response could not be processed: {type(error).__name__}."})

    def handle_eda_missions(self):
        try:
            request = Request(EDA_ENDPOINT + "missions/", headers={"User-Agent": "BeyondPulse-Hackathon/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, list):
                raise ValueError("NASA EDA returned an unexpected mission list.")
            missions = [
                {"name": str(item.get("name", "")), "title": str(item.get("title", "")), "description": str(item.get("description", ""))[:700], "link": str(item.get("link", ""))}
                for item in payload[:100]
                if isinstance(item, dict) and re.fullmatch(r"[A-Za-z0-9-]{1,40}", str(item.get("name", "")))
            ]
            self.send_json(200, {"source": "NASA OSDR Environmental Data Application", "source_url": EDA_ENDPOINT, "retrieved_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "missions": missions})
        except HTTPError as error:
            self.send_json(502, {"error": f"NASA EDA returned HTTP {error.code}."})
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            self.send_json(502, {"error": f"NASA EDA could not be reached: {type(error).__name__}."})
        except ValueError as error:
            self.send_json(502, {"error": str(error)})
        except Exception as error:
            self.send_json(502, {"error": f"NASA EDA response could not be processed: {type(error).__name__}."})

    def handle_eda(self, query):
        try:
            mission = query.get("mission", [""])[0]
            if not re.fullmatch(r"[A-Za-z0-9-]{1,40}", mission):
                raise ValueError("Choose a valid NASA EDA mission identifier.")
            start_raw, end_raw = query.get("start", [""])[0], query.get("end", [""])[0]
            if not start_raw or not end_raw:
                raise ValueError("Choose a UTC archive start and end time.")
            start, end = iso_utc(start_raw), iso_utc(end_raw)
            if end <= start:
                raise ValueError("Archive end time must be after start time.")
            if end - start > timedelta(hours=24):
                raise ValueError("Choose an EDA archive window of 24 hours or less.")
            path = f"{EDA_ENDPOINT}missions/{mission}/telemetry_data/"
            url = path + "?" + urlencode({"start": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "end": end.strftime("%Y-%m-%dT%H:%M:%SZ")})
            request = Request(url, headers={"User-Agent": "BeyondPulse-Hackathon/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, list):
                raise ValueError("NASA EDA returned an unexpected telemetry format.")
            records = []
            for row in payload[:3000]:
                if not isinstance(row, dict):
                    continue
                records.append({key: safe_value(row.get(key)) for key in ("time", "temperature_iss", "temperature_ground", "humidity_iss", "humidity_ground", "co2_iss", "co2_ground", "milestones") if key in row})
            for record in records:
                for key in ("temperature_iss", "temperature_ground", "humidity_iss", "humidity_ground", "co2_iss", "co2_ground"):
                    if key in record:
                        record[key] = safe_number(record[key])
            self.send_json(200, {
                "source": "NASA OSDR Environmental Data Application",
                "source_url": path,
                "mission": mission,
                "window_utc": f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')} to {end.strftime('%Y-%m-%dT%H:%M:%SZ')}",
                "fetched_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "units": {"temperature": "°C", "humidity": "%", "co2": "ppm"},
                "records": records,
                "rows_returned": len(records),
                "truncated": len(payload) > len(records),
                "caveat": "Archived mission environmental telemetry. It is not a current cabin feed or personal astronaut biometrics.",
            })
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except HTTPError as error:
            self.send_json(502, {"error": f"NASA EDA returned HTTP {error.code}. Check the mission and UTC window."})
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            self.send_json(502, {"error": f"NASA EDA could not be reached: {type(error).__name__}."})
        except Exception as error:
            self.send_json(502, {"error": f"NASA EDA response could not be processed: {type(error).__name__}."})

    def do_POST(self):
        if urlparse(self.path).path != "/api/insight":
            self.send_json(404, {"error": "Unknown local API route."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 32768:
                self.send_json(400, {"error": "Invalid request size."})
                return
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(body, dict) or set(body) != {"mode", "observations", "consent"}:
                self.send_json(400, {"error": "Provide a supported summary mode and selected source observations."})
                return
            if body.get("consent") is not True:
                self.send_json(400, {"error": "Explicit consent is required before sending selected readings."})
                return
            mode = body.get("mode")
            if mode not in {"crew_brief", "trend_review", "data_quality"}:
                self.send_json(400, {"error": "Unsupported AI brief type."})
                return
            incoming = body.get("observations")
            if not isinstance(incoming, list) or not 1 <= len(incoming) <= 120:
                self.send_json(400, {"error": "Select between 1 and 120 source readings."})
                return
            selected = []
            allowed_context = {
                "mission", "spacecraft", "instrumentId", "module", "latitudeDeg", "longitudeDeg",
                "altitudeKm", "magneticB", "magneticL", "groundValue", "bodySite", "selectedProfile",
                "sourceUnit", "deviceClock", "sourceTime", "timeBasis", "basis", "intervalIndex", "temperatureType",
                "scenario", "synthetic", "window",
            }
            for item in incoming:
                if not isinstance(item, dict):
                    continue
                metric = str(item.get("metric", ""))[:40]
                value = safe_number(item.get("value"))
                unit = str(item.get("unit", ""))[:24]
                source = str(item.get("source", ""))[:120]
                source_kind = str(item.get("source_kind", ""))[:32]
                if not re.fullmatch(r"[a-zA-Z0-9_ -]{1,40}", metric) or value is None or not source or source_kind != "simulation":
                    continue
                flags = item.get("flags", [])
                if not isinstance(flags, list):
                    flags = []
                context = item.get("context", {})
                if not isinstance(context, dict):
                    context = {}
                safe_context = {}
                for key in allowed_context:
                    value_context = context.get(key)
                    if isinstance(value_context, (str, int, bool)):
                        safe_context[key] = str(value_context)[:100] if isinstance(value_context, str) else value_context
                    elif isinstance(value_context, float) and math.isfinite(value_context):
                        safe_context[key] = value_context
                selected.append({
                    "metric": metric, "value": value, "unit": unit,
                    "measured_at_utc": str(item.get("measured_at") or "")[:40],
                    "received_at_utc": str(item.get("received_at") or "")[:40],
                    "source": source, "source_kind": source_kind,
                    "quality": str(item.get("quality") or "unknown")[:24],
                    "flags": [str(flag)[:80] for flag in flags[:8]],
                    "context": safe_context,
                })
            if not selected:
                self.send_json(400, {"error": "No valid source readings were supplied."})
                return
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                self.send_json(503, {"error": "Optional AI is not configured. The local explainer remains available."})
                return
            instructions = (
                "You are Beyond Pulse Signal Intelligence, a plain-language summarizer of source-labeled measurements. "
                "The user explicitly selected and consented to share the included readings. Report only what those records show. "
                "Do not diagnose, infer a medical cause, apply your own thresholds, predict outcomes, prescribe, or change a mission plan. "
                "Keep source class, timestamps, and any supplied mission context attached to every observation. A time is UTC only "
                "when the source explicitly includes a timezone. Mark NASA RadLab and NASA EDA records as archived "
                "environmental context, never as a personal dose or current cabin feed. Mark quality flags and stale/unknown times. "
                "If any record has source_kind simulation, explicitly call it synthetic fictional demonstration data created by Beyond Pulse. "
                "Never describe simulated values as NASA telemetry, NASA archive records, astronaut measurements, or real patient data. "
                "Do not infer an actual person's health from simulated inputs. Keep scenario-only summaries separate from source-backed records. "
                "If records are too few, conflicting, or questionable, say the data are insufficient. Use exactly three headings: "
                "Observed; Data quality; Consider. Under Consider, use only a low-risk action such as repeating a valid measurement "
                "or following the crew's approved medical protocol. This is not clinical advice."
            )
            mode_text = {
                "crew_brief": "Create a concise crew-facing summary of the selected readings.",
                "trend_review": "Compare selected readings over time, without labeling them normal or abnormal.",
                "data_quality": "Focus on gaps, source types, timestamps, and device quality flags; do not interpret health status.",
            }[mode]
            request_body = json.dumps({
                "model": AI_MODEL,
                "instructions": instructions,
                "input": mode_text + "\nSelected source readings:\n" + json.dumps(selected, ensure_ascii=False, allow_nan=False),
                "store": False,
                "max_output_tokens": 360,
            }).encode("utf-8")
            request = Request(
                OPENAI_ENDPOINT,
                data=request_body,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=45) as response:
                result = json.loads(response.read().decode("utf-8"))
            text_parts = []
            for item in result.get("output", []):
                if item.get("type") == "message":
                    for content in item.get("content", []):
                        if content.get("type") == "output_text" and content.get("text"):
                            text_parts.append(content["text"])
            summary = "\n".join(text_parts).strip()
            if not summary:
                raise ValueError("The model returned no text.")
            self.send_json(200, {"model": AI_MODEL, "summary": summary, "created_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "scope": "explicitly selected source observations"})
        except HTTPError as error:
            provider_error = {}
            try:
                payload = json.loads(error.read().decode("utf-8"))
                provider_error = payload.get("error", {}) if isinstance(payload, dict) else {}
            except (UnicodeDecodeError, json.JSONDecodeError, OSError):
                pass
            error_kind = " ".join(str(provider_error.get(key, "")) for key in ("type", "code")).lower()
            error_message = str(provider_error.get("message", "")).lower()
            if error.code == 429 and ("quota" in error_kind or "quota" in error_message or "billing" in error_message):
                message = "OpenAI API quota or billing limit reached. Check the API project's usage limits."
            elif error.code == 429:
                message = "OpenAI rate limit reached. Wait briefly, then retry."
            elif error.code == 401:
                message = "OpenAI rejected the API key. Check the server key configuration."
            elif error.code == 404:
                message = "The configured AI model is unavailable to this API key."
            else:
                message = f"OpenAI service returned HTTP {error.code}. Try again later."
            self.send_json(502, {"error": message})
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            self.send_json(502, {"error": f"AI summary unavailable ({type(error).__name__}). Local explanation is still available."})
        except ValueError as error:
            self.send_json(502, {"error": str(error)})
        except Exception as error:
            self.send_json(502, {"error": f"AI summary unavailable ({type(error).__name__}). Local explanation is still available."})


def main():
    port = int(os.environ.get("BEYOND_PULSE_PORT", "8001"))
    server = ThreadingHTTPServer(("127.0.0.1", port), BeyondPulseHandler)
    print(f"Beyond Pulse running at http://127.0.0.1:{port}")
    print("NASA RadLab proxy: enabled - optional AI key: " + ("configured" if os.environ.get("OPENAI_API_KEY") else "not configured"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBeyond Pulse server stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
