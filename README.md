# Beyond Pulse

**A crew-centered health workspace by Team Beyond Pulse** for NASA Space Apps Challenge 2026, “Create Health Monitoring Software for Astronauts on Space Missions.”

Beyond Pulse gives Maya—a fictional astronaut profile—one clear place to review health trends, wellbeing, activity, body-health observations, mission context, daily routines, and a clinician handoff. Source labels stay visible so a simulated value cannot be mistaken for a NASA record.

> **Prototype boundary:** Maya’s health values are generated for demonstration. They are not NASA telemetry, crew medical records, or clinically validated measurements. The app does not connect to flight sensors, diagnose, or calculate bone mineral density.

## Run locally

Requires Python 3.10 or newer. The server uses the Python standard library; no package installation is needed.

```powershell
python server.py
```

Open <http://localhost:8001>.

An optional AI brief can use the OpenAI Responses API. Set `OPENAI_API_KEY` in the server process environment; never place a key in browser code or commit it. AI is opt-in and only receives the selected synthetic scenario values. Without an available API quota, the local summary remains available.

## What the prototype demonstrates

- Maya’s seven-day fictional mission scenario, with provenance labels and trend views.
- Wellbeing, routine, activity, environment, and body-health screens in one connected workflow.
- Quantitative-ultrasound speed-of-sound (SOS) observations without converting SOS into a bone-density score.
- A NASA OSDR RadLab archive sample and optional queries to public NASA OSDR archives. These are historical research/environment records, not live crew biometrics or spacecraft sensor streams.
- An optional consent-gated AI summary and a user-reviewed medical handoff that is exported locally rather than sent automatically.

## Data and references

- [2026 Health Monitoring Software challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)
- [NASA OSDR RadLab](https://visualization.osdr.nasa.gov/radlab/gui/overview/) and its [API guide](https://visualization.osdr.nasa.gov/radlab/gui/data-api/)
- [NASA OSDR Environmental Data Application](https://visualization.osdr.nasa.gov/eda/) and its [API guide](https://visualization.osdr.nasa.gov/eda/api_reference)
- [NASA Flexible Ultrasound System](https://www.nasa.gov/glenn/glenn-expertise-space-exploration/human-health-performance/exploration-medical-technologies/flexible-ultrasound-system/)
- [NASA Human Research Program: Risks of Human Spaceflight](https://www.nasa.gov/hrp/risks/)
- [NASA Brahms/Ejenta technology-transfer overview](https://www.nasa.gov/technology/tech-transfer-spinoffs/astronaut-artificial-intelligence-monitors-patients-at-home/)

The bundled `data/radlab-iss-sample.json` is an archived NASA RadLab sample. The app keeps that archive data separate from Maya’s synthetic scenario. NASA systems and technologies are cited as references; this independent prototype is not developed, operated, validated, or endorsed by NASA.

## AI and medical-use limits

The optional AI feature is a general-purpose summarizer, not a trained medical model or medical decision system. It does not diagnose, set clinical limits, or recommend treatment. The prototype is not for real medical records or operational use. A flight deployment would require authorized interfaces, approved medical rules, secure identity and communications, and formal verification.

See [SUBMISSION.md](SUBMISSION.md) for paste-ready project text, source attribution, AI disclosure, and a short demo outline.
