# NASA Space Apps submission notes

## Project details

- **Team:** Beyond Pulse
- **Project title:** Beyond Pulse
- **Challenge:** [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)
- **Repository:** https://github.com/dylonplayz/beyond-pulse
- **Demo video:** Add the public video link after uploading; check it in a private/incognito window.

## Short description

Beyond Pulse is a source-aware crew health workspace for Maya, a fictional astronaut profile. It brings simulated health trends, wellbeing, activity, body-health observations, mission context, and clinician handoff into one clear interface, with historical NASA radiation data shown separately from fictional crew values.

## Project description

Long-duration missions make it harder for a crew member to notice how health indicators are changing and to communicate a useful, organized picture to medical support. Beyond Pulse explores a crew-centered answer: one workspace that connects trends, wellbeing, activity and routines, body-health observations, mission environment, and a reviewed clinician handoff.

The demonstration follows Maya, a fictional astronaut on a seven-day mission scenario. Her generated values are explicitly labeled as simulated. A separate Environment view presents historical NASA OSDR RadLab archive data, preserving the distinction between research/environment records and a crew member’s health. The body-health workflow demonstrates quantitative-ultrasound speed-of-sound (SOS) observations; it does not infer bone mineral density. An optional, consent-gated AI brief summarizes selected fictional values, while the handoff remains under user review and is exported locally.

Beyond Pulse is a prototype, not a NASA flight system or medical device. It does not connect to spacecraft sensors, diagnose, or send data automatically to a clinician. The project demonstrates how source-aware software could help a crew member understand a changing health picture and prepare a clear handoff for authorized medical personnel.

## NASA data and resources used

- NASA OSDR RadLab archive data is bundled in `data/radlab-iss-sample.json` and identified in the Environment view as historical archive data.
- The app can query public NASA OSDR RadLab and Environmental Data Application (EDA) archives. These are research/archive sources, not current astronaut biometrics or live flight-system data.
- NASA’s Flexible Ultrasound System, Human Research Program, and Brahms/Ejenta materials informed the concept and design references; Beyond Pulse does not claim to run those systems or use NASA flight hardware.

References: [NASA OSDR RadLab overview](https://visualization.osdr.nasa.gov/radlab/gui/overview/), [RadLab API guide](https://visualization.osdr.nasa.gov/radlab/gui/data-api/), [NASA OSDR EDA](https://visualization.osdr.nasa.gov/eda/), [NASA Flexible Ultrasound System](https://www.nasa.gov/glenn/glenn-expertise-space-exploration/human-health-performance/exploration-medical-technologies/flexible-ultrasound-system/), [NASA Human Research Program](https://www.nasa.gov/hrp/risks/), and [NASA Brahms/Ejenta overview](https://www.nasa.gov/technology/tech-transfer-spinoffs/astronaut-artificial-intelligence-monitors-patients-at-home/).

## AI disclosure

AI tools assisted with project ideation and software development. The app has an optional OpenAI-powered summary that runs only after the user consents and selects fictional Maya scenario values. A local summary is available without the API. The feature is not a trained medical AI, does not diagnose, and does not make treatment decisions. Disclose any AI image or video tools actually used in the submitted demo materials as well.

## Suggested 60-second demo

1. **0–8 sec:** Introduce Maya and the challenge: health information in a long mission needs to be understandable and connected.
2. **8–20 sec:** Show the home dashboard and a trend, pointing out that Maya’s values are clearly marked simulated.
3. **20–30 sec:** Show body health and explain that the QUS example reports speed of sound only; no bone-density score is inferred.
4. **30–40 sec:** Show Environment and distinguish the historical NASA RadLab archive from Maya’s fictional values.
5. **40–50 sec:** Show the optional AI brief and its consent step.
6. **50–60 sec:** Show the reviewed medical handoff and close on the goal: helping a crew member understand their health picture and communicate it clearly.

## Before clicking Submit

- Add every registered teammate to the project page and verify the team and challenge selection.
- Add the final public demo link and any required media.
- Include the GitHub repository and NASA/third-party references.
- Complete the platform’s AI-use disclosure and accept the submission terms.
- Click the final submit control and confirm the project page shows **Submitted**.
