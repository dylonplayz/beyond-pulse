# TIDE — Trusted Integrated Decision Environment

**A whole-mission health picture for each astronaut, with private onboard guidance and a secure medical operations view on Earth.**

**Team — Beyond Pulse:** We’re building thoughtful health technology for crews working far from Earth, connecting personal health signals with clear guidance and a trusted medical support network.

## Working concept demo

Serve the folder locally (for example, `python -m http.server 8000`) and open `http://localhost:8000`. On first load, the service worker caches the static app for offline use. The link control separately simulates a delayed communications channel and moves packets between views in the same browser. Everything is synthetic and local: there is no sensor connection, medical model, clinician, external alert, secure clinical database, or ground server. Demo notes are stored in this browser's `localStorage`, which is not encrypted; do not enter real health information.

NASA's challenge asks teams to build software that gathers astronaut health indicators and helps astronauts evaluate and act on their health during space missions. TIDE connects an astronaut's changing health, spacecraft environment and mission demands, then helps the crew and authorized medical team see what may need attention. It is built for the gap between a single alarming vital and a crew member who is slowly drifting away from their own healthy pattern.

## The idea

On a long mission, a fixed threshold can miss a meaningful change in one astronaut, while ordinary variation can make a fixed threshold noisy for another. TIDE learns a transparent, personal reference range from each crew member's recent data, then looks for small changes that line up across different signals and mission context.

Instead of returning an opaque diagnosis or a generic red/green score, it shows a **health thread**:

> “Your recovery signals have shifted for three days: sleep is shorter, resting pulse is above your recent range, and your hydration check-ins are lower. This pattern followed two high-workload days. Sensor coverage is good. Consider the approved recovery steps and repeat the check-in; if it persists or you feel unwell, open the onboard medical protocol.”

The explanation separates **what was measured**, **what changed from this person's baseline**, **what context may be relevant**, and **what safe next step is available**. It labels associations as clues, not causes.

## What makes TIDE distinctive

- **Personal drift, not one-size-fits-all cutoffs.** Establish a baseline and compare each person with their own recent pattern; retain hard safety limits only where an approved protocol supplies them.
- **Converging weak signals.** Surface patterns across sleep, resting heart rate/HRV, hydration, workload, exercise and a brief mood/energy check-in. A single questionable sensor should not create an alarm.
- **Mission context beside the signal.** Put workload, exercise, sleep opportunity and mission day on the same timeline so a crew member can interpret a change without the app claiming causation.
- **Actions with a follow-up.** Offer low-risk, protocol-approved actions and a suggested recheck window. Show whether the signal improved, persisted or needs escalation.
- **Honest uncertainty.** Show sensor freshness, missing-data coverage, confidence and which inputs drove the message. If evidence is sparse, say “not enough data” rather than inventing certainty.
- **Crew trust by design.** Keep personal check-ins private by default. Give the astronaut a clear choice to prepare a clinician handoff or share a concern; use only an explicitly configured safety protocol for urgent escalation.
- **Works without Earth.** Keep the rule engine, recent trends, protocol cards and data capture on-device. Queue timestamped records locally and reconcile them when a link returns.

## Hackathon MVP

Build one polished astronaut-facing web app that works offline and demonstrates the complete **gather → evaluate → act → recheck** loop.

1. **Mission dashboard:** current status, last-synced time, signal freshness, and a compact 7–14 day personal trend.
2. **Health thread:** an explainable card linking a multi-day change to its measured inputs and mission timeline.
3. **Check-in:** manual vitals plus sleep, hydration, workload, energy and mood entries; clearly mark demo/simulated values.
4. **Action plan:** a small set of carefully worded, non-diagnostic steps, recheck timing, and a route to the onboard medical protocol.
5. **After-action view:** compare follow-up observations with the earlier pattern and preserve the astronaut's own notes.
6. **Offline demo:** seed a labeled synthetic mission timeline and show the same interaction with the network disabled.

Keep the demo dataset visibly synthetic unless a NASA source dataset has been verified and cited. Do not present invented thresholds as NASA limits or imply that a prototype is flight-certified.

## A memorable 90-second demo

1. Start on “Day 42 — all individual readings are still inside broad reference limits.”
2. Reveal three days of slightly shorter sleep, lower hydration check-ins and elevated resting pulse/declining HRV after consecutive high-workload days.
3. TIDE flags a **watch pattern**, shows the three contributing signals, their freshness and the workload context, and explains why no single measurement triggered it.
4. The astronaut chooses a routine recovery action and sets a recheck; the app states that this is not a diagnosis.
5. Disable connectivity, enter the follow-up check-in, and show the local timeline update. End with a concise handoff packet the astronaut can choose to share.

This story demonstrates a useful early signal without pretending that software can diagnose an astronaut or replace flight medicine.

## Suggested decision model

Use a deterministic, inspectable MVP before considering machine learning. For each signal, calculate deviation from a rolling personal baseline only when the baseline and data quality are sufficient. Combine persistence, magnitude, number of independent domains, and data quality into **steady / watch / seek crew medical review**. Hard escalation must come from an authoritative medical protocol, never an improvised hackathon threshold.

Every surfaced pattern should answer:

- What changed, and over what time window?
- Which observations support this message?
- How complete and recent is the data?
- What is the least burdensome safe next step?
- When should the astronaut recheck or seek onboard medical review?

## Build order

1. Agree on a small, explicit data schema and label all demo data as synthetic.
2. Implement local data capture and a seeded multi-day scenario.
3. Implement and document the transparent drift rules.
4. Build the timeline, health-thread explanation and action/recheck flow.
5. Demonstrate offline behavior and rehearse the 90-second story.
6. Add a short source panel explaining which public NASA data or risk material informed the prototype; distinguish background evidence from operational medical guidance.

## Guardrails

TIDE is a concept prototype, not a medical device. It does not diagnose, prescribe, calculate treatment, or replace a crew medical officer. Do not hard-code clinical thresholds from guesswork. Keep sensitive data local in the demo, make sharing visible and voluntary, and clearly label missing, synthetic and stale data.

## One-sentence pitch

**TIDE helps astronauts notice when several small, personal health changes are lining up, understand the evidence and its limits, take a safe next step, and check whether it helped—even when Earth is out of reach.**

## Expanded system: onboard care + mission health center

The full vision has two connected workspaces backed by one delay-tolerant health record. The spacecraft is the place where care must continue; Earth is a high-context clinical partner when a communication window permits. Either side can keep working during a disconnect.

### 1. Astronaut health companion

The private, personal workspace brings together the astronaut's own data and gives it back in useful form:

- **Body and function:** heart rate and HRV, blood pressure, oxygen saturation when available, temperature, body mass, vision/eye screening, balance or motion-sickness check-ins, pain, injury, symptoms and clinician-collected measurements.
- **Sleep and recovery:** sleep duration and timing, schedule shifts, fatigue, workload and exercise sessions, with recovery patterns shown over time.
- **Nutrition and daily habits:** meals and available nutrient summaries, hydration, gastrointestinal check-ins, medication/supplement logs and countermeasure completion.
- **Mind and team wellbeing:** private mood, stress, focus and social-connection check-ins; a voluntary way to ask for a confidential conversation. These are not converted into a performance grade.
- **Mission and environment:** mission phase, EVA/workload schedule, exercise opportunity, radiation dosimeter summaries, and relevant cabin telemetry such as CO₂, temperature, humidity, pressure, lighting and noise when those data are available.
- **Clinical observations:** clinician-entered notes, images and exam results with source, time, units and provenance attached.

TIDE does not claim that every signal can be measured continuously or that every mission has every sensor. A **coverage map** makes missing, stale, manual, estimated and sensor-measured inputs visible. Astronauts can correct context or annotate a signal (for example, “sensor loose” or “just finished exercise”).

### 2. Safe self-triage and health improvement

When an astronaut reports a symptom or TIDE notices a pattern, the companion opens a structured pathway:

1. **Check urgency first.** Ask focused questions from a locally available, clinician-authored protocol. If a configured red-flag rule matches, show the required emergency action immediately; do not make the user finish an AI chat.
2. **Explain the signal.** Show the observation, personal baseline, trend duration, data quality, mission context and the exact reason this pathway appeared.
3. **Support self-triage.** Present protocol-linked possibilities as considerations, with uncertainty and a plain-language explanation. Never label one as the astronaut's diagnosis or rank speculative diseases as fact.
4. **Offer approved next steps.** Show only the mission's approved self-care, measurement, rest, countermeasure or contact steps, with clear “do now / recheck / contact medical officer” instructions and source/version information.
5. **Close the loop.** Schedule a recheck and compare follow-up. If the symptom persists, worsens, or crosses a medical escalation rule, prepare an escalation and handoff rather than looping through generic wellness advice.

For longer-term improvement, the astronaut can choose a small goal—such as a sleep routine or countermeasure plan—and see whether it helps their own trend. The app should support autonomy, not shame, reward streaks, or quietly turn wellbeing into a productivity score.

### 3. Crew medical officer workspace

The onboard medical officer gets a prioritized crew overview designed for action rather than surveillance: new escalations, open follow-ups, data gaps and crew-wide operational stressors. Selecting a person opens only the access-authorized clinical view, including the timeline, relevant records, astronaut notes shared for care, protocol history and a concise event summary. The medical officer can acknowledge an alert, record an assessment, assign a follow-up or prepare a ground consultation.

An aggregate view can reveal shared environmental or schedule patterns—for example, several crew members reporting poor sleep after a lighting or workload change—without exposing each person's private check-in by default.

### 4. Earth mission health center

The centralized ground console gives authorized flight surgeons and mission health staff a mission-wide view while respecting clinical roles:

- **Crew status board:** last contact/sync, open clinical events, urgency, owner, next action and time to follow-up.
- **Individual clinical timeline:** relevant trends and events, source/device provenance, sensor quality, clinician annotations, protocol steps and unresolved questions.
- **Mission context overlay:** health events beside mission phase, exercise, EVA/workload, radiation and environmental records, so clinicians can investigate possible relationships without asserting causation.
- **Asynchronous care packet:** astronaut's symptom answers, vitals/trend snippets, actions tried, follow-up and specific question for the flight surgeon. Staff can return a signed, versioned response that is stored onboard for later access.
- **Population safety view:** carefully limited, de-identified or thresholded aggregates for shared risk investigation; never a crew ranking or mental-health leaderboard.
- **Audit and accountability:** role-based permissions, access log, data lineage, protocol/model version, acknowledgment state and recorded reasons for escalation or access.

“Centralized” means authorized clinicians can reach a coherent record—not that every person in mission control sees every intimate detail. Provide least-privilege roles, encryption, explicit access history, retention controls and a documented emergency “break-glass” path. Individual behavioral check-ins remain private by default; sharing for treatment is explicit, and any safety exception must be defined by mission policy and visible to the astronaut.

### 5. Deep-space communications and resilience

TIDE is **onboard-first and delay tolerant**. Data are timestamped at capture, stored encrypted locally and placed into a signed store-and-forward queue. The onboard care loop does not call a cloud model. When a link is available, the system sends prioritized clinical events first and bulk/low-priority data later. Ground replies are versioned, acknowledged and safely reconciled; the interface marks what is current onboard, queued, received by Earth or awaiting a response. If Earth is unreachable, the last approved protocol set and crew medical officer workflow remain available.

This is a mission requirement: NASA describes crewed Mars communications as having one-way delay above 21–23 minutes on some trajectories, with communication blackouts also possible. The astronaut cannot wait for a round trip to begin urgent care. [NASA communications analysis](https://www.nasa.gov/wp-content/uploads/2024/01/mars-communications-disruption-and-delay.pdf)

### 6. Decision-support architecture

Use a **safety envelope** around any AI:

- A deterministic protocol and rules layer owns urgency, forbidden actions and escalation. Protocols must be authored/approved by medical authorities for the mission; the prototype uses plainly labeled demo pathways.
- A personal-trend layer detects persistence and multi-signal changes only when each input passes freshness and quality checks. It can explain associations, never claim that one exposure caused a symptom.
- A local language interface can summarize records and find passages in an approved medical library, quoting source/version and asking for clarification when needed. It cannot invent guidance, change an escalation level, or override rules.
- Every recommendation is traceable to inputs and an approved source. If data are missing, inconsistent, outside the validated range or the user's symptoms are worsening, abstain and route to the clinician.
- The hackathon version should be deterministic and scripted, not a medical chatbot trained on guessed thresholds. No patient-level predictive risk score should be shown as validated without appropriate clinical evidence.

## Data design and NASA grounding

Represent each observation as a typed, unit-bearing event: **who/which sensor, what, value, unit, measured-at time, received-at time, quality, provenance, context, consent/access class, and schema version**. Keep raw observations, derived trends and clinical interpretations distinct. Preserve corrections and audit history rather than silently overwriting records.

NASA's Human Research Program describes interacting risks across physiology, behavior/performance, radiation, altered gravity, isolation/confinement and hostile closed environments; the system therefore organizes signals by these domains and by mission context instead of treating vitals as the entire health picture. [NASA human-spaceflight risks](https://www.nasa.gov/hrp/risks/) · [NASA five hazards](https://www.nasa.gov/hrp/hazards/)

For scientific grounding, use NASA's [Open Science Data Repository](https://osdr.nasa.gov/bio/repo/) to find relevant published human, analog and space biology studies. Dataset use must be precise: much OSDR material is research data, not live operational telemetry or a clinical reference range. Cite the exact study and explain what it supports; never use research associations alone to create treatment guidance.

## Expanded product narrative

**TIDE is the health operating picture for deep-space crews.** It notices a change, shows the evidence, helps the astronaut safely assess it, preserves the crew's ability to act without Earth, and gives the flight surgeon a clear asynchronous handoff when contact returns. Its most ambitious feature is not an AI diagnosis; it is continuity of care across the astronaut, onboard medical officer and ground team despite incomplete sensors, sensitive data and delayed communications.

## Hackathon demo extension

Keep the deliverable bounded to three connected screens rather than trying to implement the whole vision:

1. **Astronaut companion:** multi-day personal trend, symptom self-triage pathway, explanation and safe follow-up.
2. **Onboard medical officer:** a crew event queue, one case timeline and an environmental context overlay.
3. **Ground mission health center:** the same case arriving after simulated link restoration, with data lineage, an asynchronous clinician response and acknowledgement returning to the spacecraft.

Use one carefully designed synthetic scenario. Demonstrate the complete loop: a subtle cross-domain trend appears; the astronaut reports a symptom; a deterministic demo pathway routes worsening or uncertain symptoms to human medical support; an onboard clinician reviews the evidence; a compact packet queues while disconnected; ground receives it later and sends a response. This shows whole-system value without claiming the prototype is ready for flight or clinical use.

## Implemented prototype capabilities

- **Astronaut health dashboard:** synthetic vital, sleep, hydration, exercise and spacecraft-context panels; trend explanation; daily symptom check-in.
- **Health assistant:** local, scripted chat that helps organize a report, points to the medication and consultation views, and creates a clearly labeled local priority item for a small set of demo phrases. It is not an LLM, diagnosis engine, or validated emergency detector.
- **Medication plan:** a fictional clinician-approved order, scheduled reminder actions, dose logging, private observation notes, sample stock awareness and a review-request workflow. It has no drug database, interaction checker, or prescribing feature.
- **Doctor consultation:** communication-profile selector for Mars-like, lunar and near-Earth scenarios; consultation packet, optional local attachment-name capture, share controls, and a response path. No live audio/video or actual message transmission is connected.
- **Onboard and ground views:** the same browser-local demo packets appear in the crew medical and mission health center pages. Toggling the simulated link demonstrates store-and-forward state changes.
- **Offline static app:** the service worker caches app assets when served from localhost or HTTPS; browser-local demo records remain in `localStorage`. The prototype does not encrypt these records or synchronize between devices.
- **Protocol and sensor pages:** clearly labeled demo pathways and synthetic sensor provenance, including missing/stale signals.

## What this project can and cannot solve

Software can help crews notice changes, organize evidence, coordinate care, follow an existing medication plan, and keep a consultation moving during a delay. It cannot remove radiation, microgravity, isolation, toxic exposures, communication blackouts, limited medical supplies, or the biological uncertainty of long missions. Those require spacecraft engineering, medical research, mission protocols, clinician judgment, and validated countermeasures alongside software.

NASA already has astronaut medical operations and information systems, including records, imaging, mission medical repositories, exercise and radiation tools. NASA and partners are also evaluating clinical decision-support concepts and robotic medical assistance. TIDE should be presented as a **crew-facing care continuity and health-management concept that could integrate with approved systems**, not as a replacement for them or as the first astronaut health database. [NASA Medical Information Systems and Tools](https://www.nasa.gov/directorates/esdmd/hhp/medical-information-systems-and-tools-mist/) · [NASA CMO-DA research presentation](https://ntrs.nasa.gov/citations/20260001797) · [NASA medication considerations](https://www.nasa.gov/reference/medical-operations-and-clinical-care/)

## Real-system requirements before clinical use

The hackathon demo intentionally stops before the most safety-critical parts. A flight system would require mission-approved clinical protocols, independent clinical validation across cases and populations, vetted sensor integrations and quality checks, a clinician-controlled medication formulary, signed orders, identity and access management, encryption at rest and in transit, tamper-evident audit, backup/recovery, radiation-tolerant hardware, reliable alert routing and acknowledgement, and end-to-end communications testing. A priority item in this prototype is only a visible local simulation; it cannot page a doctor or station.

The strongest differentiator is the **closed care loop across distance**: notice a health change, help the astronaut structure a report, support the onboard medical officer, queue a clinician consultation, and return the response to the crew with the original evidence and timestamps. AI can assist with explanation and retrieval, but approved protocols and human clinicians retain clinical authority. No AI claim should imply the prototype can diagnose every illness or prescribe treatment.

## Source anchors

- [2026 NASA Space Apps health monitoring challenge](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)
- [NASA Human Research Program: risks of human spaceflight](https://www.nasa.gov/hrp/risks/)
- [NASA Human Research Program: five hazards](https://www.nasa.gov/hrp/hazards/)
- [NASA deep-space communications delays and disruptions](https://www.nasa.gov/wp-content/uploads/2024/01/mars-communications-disruption-and-delay.pdf)
- [NASA Open Science Data Repository](https://osdr.nasa.gov/bio/repo/)
