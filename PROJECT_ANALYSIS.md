# Tzel Project Analysis

## 1. Project Overview

**Tzel** is a comprehensive, highly automated Open Source Intelligence (OSINT) and data pipeline designed for the Real Estate sector, specifically focusing on **Surplus Funds (Overages) Recovery** and **Distressed Property Acquisition**.

The system automates the arduous manual process of identifying real estate opportunities by discovering and downloading county foreclosure lists, auditing liens and debts, verifying legal statuses like bankruptcies, performing skip tracing to locate property owners, and eventually delivering highly qualified, actionable leads via Telegram.

## 2. Architecture & Tech Stack

Tzel is primarily built with **TypeScript** and **Node.js**, leveraging modern web scraping, headless browsers, and API integrations.

*   **Database:** **Turso (libSQL/SQLite)** is used as the primary data store, providing a fast, edge-optimized SQL database.
*   **Web Scraping & Automation:** Uses **Crawlee** and **Playwright** for complex web scraping, handling dynamic content, and bypassing anti-bot protections. **Colly (Go)** is also used for high-speed static scraping (`tzel_high_speed_scraper.go`).
*   **APIs & Integrations:** Integrates with real estate APIs (e.g., Spark API/FlexMLS, BatchData), OSINT tools, Telegram API (for notifications), and Google Gemini (for processing unstructured data like PDFs and complex lien checks).
*   **Proxy & Anti-Bot Bypass:** Designed to handle captchas and anti-bot systems using residential proxies and third-party bypass services (e.g., CapSolver, ZenRows) as detailed in the documentation.

## 3. Core Components & Pipelines

The application is structured around massive, multi-layered pipelines that execute sequences of data ingestion, enrichment, and auditing.

### `run_pipeline.ts` (Main Foreclosure Pipeline)
This is the core orchestrator for the foreclosure and distressed real estate acquisition process. It executes in several "Layers" (Capas):
1.  **Target Acquisition:** Scrapes multiple county sources (Jefferson KY, Indiana Sheriff, state edicts, PVA/GIS) for foreclosures, code violations, probates, divorces, and physical/financial distress.
2.  **Identity & Skip Tracing:** Runs the Indiana Court Crawler, performs skip tracing, unifies fuzzy owner names, and does OSINT enrichment (LLC unmasking, social profiles).
3.  **Financial Audit & Title Check:** Cross-references with MLS, analyzes appraisal PDFs, and deeply verifies hidden liens.
4.  **Intelligence & Dispatch:** Calculates a Stress Scoring Index (SSI) and dispatches alerts via Telegram.
5.  **Surplus Funds Audit:** Post-auction analysis for claimable excess funds.

### `run_pipeline_legal.ts` (Legal & Financial Pipeline)
A specialized pipeline focusing heavily on pre-foreclosures, court judgments, and liens. It shares many layers with the main pipeline but is tailored towards early-stage legal distress and financial liabilities.

### `indiana_court_crawler.ts`
A specialized scraper that interfaces with the Indiana courts system (MyCase). 
*   **Purpose:** Resolves missing information for pending foreclosures. It searches by address or owner name to find the exact case number, plaintiff (creditor), defendant (debtor), and the actual debt amount.
*   **Mechanism:** Uses a mix of free extraction and paid fallbacks (BatchData) to bypass rate limits or handle missing data. It marks properties as "high yield" if the debt is significantly lower than the estimated market value.

### `check_title_liens.ts`
A critical component for financial due diligence.
*   **Purpose:** Audits property titles to detect hidden mortgages, secondary liens, and code violation fines.
*   **Mechanism:** Uses a combination of Spark API, County Clerk scrapers, and Playwright stealth. It calculates a revised Maximum Allowable Offer (MAO) by subtracting discovered hidden debts from the property's After Repair Value (ARV). It issues "RED ALERTS" if severe hidden debts are found.

### `notify_opportunities.ts`
The dispatch module that bridges the backend with the human operators.
*   **Purpose:** Aggregates all collected data for a given lead (address, financial details, distress signals, life events, photos) and formats it into a rich HTML Telegram message.
*   **Mechanism:** It provides an interactive button interface, allowing operators to instantly view PVA facade photos, Street View history, unmask LLCs, or open Google Maps. It marks records in the database as `telegram_sent = 1` to prevent duplicate alerts.

## 4. Data Schemas (`schema.sql`)

Tzel uses a highly relational and comprehensive database schema to track every aspect of a property and its owner:

*   **`foreclosure_auctions`:** Tracks upcoming court auctions, including case numbers, plaintiffs, defendants, debt amounts, estimated values, and hidden mortgages.
*   **`osint_opportunities`:** General real estate leads from MLS or other sources, tracking price drops, days on market, and keywords.
*   **`code_violations` & `physical_distress`:** Tracks structural issues, condemnations, and city code violations.
*   **`financial_distress` & `life_events`:** Records tax liens, evictions, arrests, and obituaries that signal a motivated seller.
*   **`probates`, `divorces`, `bankruptcies`:** Legal life events that force property sales or complicate titles.
*   **`surplus_funds`:** Post-auction data to calculate the clean surplus amount claimable by the original owner.
*   **`osint_enrichment`:** Deep OSINT data including LLC directors, social profiles, and usernames.

## 5. Recommendations & Optimization Opportunities

1.  **Code Modularity and Duplication:** The pipeline files (`run_pipeline.ts`, `run_pipeline_legal.ts`) are large monolithic orchestrators with duplicated try-catch blocks and logging. Refactoring these into a state machine or a task queue system (like BullMQ or temporal.io) would improve resilience, retries, and error tracking.
2.  **Database Connection Management:** The Turso database client is frequently re-instantiated or passed around. Implementing a centralized connection pool/singleton with robust retry mechanisms for database transactions would prevent connection exhaustion and transient SQLite lock errors.
3.  **Concurrency Control in Scrapers:** Some scrapers appear to run sequentially in loops (e.g., `for (const row of auctions)` with an `await sleep()`). Utilizing asynchronous batching (e.g., `Promise.all` with concurrency limits using libraries like `p-limit`) could significantly speed up scraping and API calls while respecting rate limits.
4.  **Centralized Alerting System:** The Telegram notification logic is slightly intertwined with the scrapers in some areas (e.g., sending red alerts directly from `check_title_liens.ts`). Decoupling this via an event-driven architecture (Event Emitter or Pub/Sub) would make the notification system cleaner and easier to test.
5.  **Testing Strategy:** There is a minimal presence of test files. Adding unit tests for complex business logic (like MAO calculation or name fuzzy matching) and integration tests for the database schemas would ensure stability as the project scales.
6.  **Proxy Management Enhancement:** As outlined in `paid_bypass_strategies.md`, integrating a robust proxy rotator and CAPTCHA solver directly into a unified HTTP client wrapper (rather than piecemeal) would make all scrapers inherently more resilient against IP bans.
