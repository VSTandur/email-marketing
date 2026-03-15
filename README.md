# 🚀 SFMC Email Marketing Mastery Hub

A comprehensive, production-ready resource library for Salesforce Marketing Cloud (SFMC) practitioners — covering AMPscript templates, SQL segmentation, Journey Builder strategies, automation workflows, personalization tactics, A/B testing frameworks, deliverability best practices, and analytics reporting.

---

## ⚙️ Automated Build and QC

This repository ships with a fully automated **Build and QC system** for both Journey Builder configurations and email content design. Every push or PR is automatically validated by a 6-job CI/CD pipeline.

**→ See [docs/capabilities.md](docs/capabilities.md) for a complete capabilities reference.**

### Quick start

```bash
npm install

npm run qc:email      # Check all HTML email templates (16 rules)
npm run qc:journey    # Check all journey configs (12 rules + JSON Schema)
npm run qc:presend    # Full pre-send deployment gate (8 sections)
npm run qc:all        # Run everything
npm test              # Run 84 unit tests for the QC engine
```

### What gets checked

| Area | Checks |
|------|--------|
| **Email content** | CAN-SPAM compliance, AMPscript syntax, accessibility, mobile responsiveness, spam trigger words, link tracking, no JavaScript, preheader |
| **Journey Builder** | Email asset linkage, wait durations, split branch integrity, random split percentages, orphaned activities, entry mode, goal and exit criteria |
| **Pre-send gate** | Combines both + subject line length, SQL file presence |
| **CI pipeline** | Runs on every push/PR; blocks merge on any error; uploads JSON reports as 30-day artifacts |

---

## 📂 Repository Structure

```
├── .github/workflows/
│   └── qc-pipeline.yml         # 6-job automated CI/CD QC pipeline
├── templates/
│   ├── email-templates/        # Ready-to-deploy HTML email templates with AMPscript
│   └── ampscript/              # Reusable AMPscript snippets & functions
├── journeys/
│   ├── examples/               # Journey JSON configs (export from SFMC API)
│   └── schemas/                # JSON Schema for journey validation
├── sql/
│   ├── segmentation/           # Audience segmentation queries for Data Extensions
│   └── analytics/              # Reporting & performance analytics queries
├── scripts/
│   ├── qc/                     # QC engine (email-qc.js, journey-qc.js, pre-send-checklist.js)
│   │   ├── rules/              # Rule functions (email-rules.js, journey-rules.js)
│   │   ├── reporters/          # Console + JSON reporters
│   │   └── tests/              # 84 unit tests for QC rules
│   └── ssjs/                   # Server-Side JavaScript (SSJS) utilities
└── docs/
    ├── capabilities.md         # Build and QC capabilities reference
    └── build-and-qc.md         # End-to-end Build and QC process guide
```

---

## 💡 Unique SFMC Strategy Ideas

### 1. Predictive Send-Time Optimization
Use Einstein Send Time Optimization (STO) combined with custom SQL to identify each subscriber's historical open-time window and pre-segment them before Einstein kicks in — giving you a warm-start advantage.

### 2. Behavioral Trigger Cascades
Build multi-step Journey Builder paths triggered by micro-behaviors (product page visits, video plays, PDF downloads) synced via Marketing Cloud Connect or API events — not just email opens/clicks.

### 3. AMPscript-Powered 1:1 Personalization at Scale
Use AMPscript `LOOKUP()` and `LOOKUPROWS()` against real-time Data Extensions to render fully individualized content blocks (recommended products, loyalty tier rewards, nearest store locations) without needing a separate content management tool.

### 4. Suppression Intelligence
Build a dynamic suppression Data Extension using SQL automation that auto-removes subscribers who have complained, hard-bounced, or gone inactive beyond your engagement window — protecting your sender reputation automatically.

### 5. Engagement Scoring Model
Implement a rolling 90-day engagement score (opens + clicks weighted, with recency decay) via nightly SQL automation. Use this score to tier subscribers and power re-engagement journeys before they become completely inactive.

### 6. Zero-Party Data Capture Journeys
Design SMS + Email preference center journeys using CloudPages that capture explicit subscriber interests, which are written back to a Preference Data Extension and used to drive hyper-targeted content.

### 7. Transactional Email Intelligence
Overlay transactional emails (order confirmations, shipping notices) with behavioral cross-sell recommendations using AMPscript lookups against a product affinity Data Extension — turning transactional moments into revenue opportunities.

### 8. Real-Time Weather or Location Personalization
Use AMPscript + SSJS to call a weather API or geolocation service at open time via a CloudPage redirect, then serve location-aware content (seasonal offers, store inventory) that is fresh at the moment of open.

### 9. Loyalty Tier Gamification Emails
Create dynamic progress-bar email graphics using AMPscript-computed percentage variables to show each subscriber exactly how far they are from their next loyalty tier — driving repeat purchase urgency.

### 10. Reactivation Auction Strategy
Instead of a single re-engagement email, build a 5-step auction-style sequence where the offer value escalates automatically (10% → 15% → 20% → free shipping → mystery gift) and stops the moment a subscriber re-engages.

---

## 🛠️ Quick Start

1. **Templates** → Copy any template from `templates/email-templates/` into SFMC Content Builder
2. **AMPscript Snippets** → Drop snippets from `templates/ampscript/` into your existing email templates
3. **SQL Queries** → Import queries from `sql/` into Automation Studio SQL activities
4. **SSJS Scripts** → Use scripts from `scripts/ssjs/` in CloudPages or Script activities
5. **Docs** → Read strategy guides in `docs/` before planning your next campaign or journey

---

## 📋 Prerequisites

- Salesforce Marketing Cloud with at least **Email Studio** and **Automation Studio**
- Journey Builder license (for journey templates)
- CloudPages license (for SSJS scripts and landing pages)
- Einstein features (for send-time optimization ideas)
- Basic familiarity with AMPscript and SQL

---

## 🤝 Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/new-template`)
3. Add your template/script/doc following the existing structure
4. Submit a Pull Request with a description of what the resource does

---

## 📄 License

MIT — free to use, modify, and distribute in your SFMC implementations.
