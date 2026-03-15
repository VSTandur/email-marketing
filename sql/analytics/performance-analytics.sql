-- ============================================================
-- SFMC Automation Studio — Analytics & Reporting SQL Queries
-- ============================================================
-- Run these in Automation Studio SQL activities to populate
-- reporting Data Extensions, then visualise in Analytics Builder
-- or export to your BI tool (Tableau, Looker, Power BI).
-- ============================================================


-- ============================================================
-- 1. CAMPAIGN PERFORMANCE SUMMARY
-- ============================================================
-- Aggregates key email metrics per job (send).
-- Output: CampaignPerformance_DE
-- Schedule: Daily
-- ============================================================
SELECT
    j.JobID,
    j.EmailName,
    j.FromName,
    j.SendDate,
    j.Category                                          AS FolderCategory,
    COUNT(DISTINCT s.SubscriberKey)                     AS TotalSent,
    COUNT(DISTINCT o.SubscriberKey)                     AS UniqueOpens,
    COUNT(DISTINCT c.SubscriberKey)                     AS UniqueClicks,
    COUNT(DISTINCT b.SubscriberKey)                     AS Bounces,
    COUNT(DISTINCT u.SubscriberKey)                     AS Unsubscribes,
    COUNT(DISTINCT comp.SubscriberKey)                  AS SpamComplaints,
    -- Rates
    CASE WHEN COUNT(DISTINCT s.SubscriberKey) > 0
         THEN ROUND(CAST(COUNT(DISTINCT o.SubscriberKey) AS FLOAT) /
                    COUNT(DISTINCT s.SubscriberKey) * 100, 2)
         ELSE 0 END                                     AS OpenRate,
    CASE WHEN COUNT(DISTINCT o.SubscriberKey) > 0
         THEN ROUND(CAST(COUNT(DISTINCT c.SubscriberKey) AS FLOAT) /
                    COUNT(DISTINCT o.SubscriberKey) * 100, 2)
         ELSE 0 END                                     AS ClickToOpenRate,
    CASE WHEN COUNT(DISTINCT s.SubscriberKey) > 0
         THEN ROUND(CAST(COUNT(DISTINCT c.SubscriberKey) AS FLOAT) /
                    COUNT(DISTINCT s.SubscriberKey) * 100, 2)
         ELSE 0 END                                     AS ClickRate,
    CASE WHEN COUNT(DISTINCT s.SubscriberKey) > 0
         THEN ROUND(CAST(COUNT(DISTINCT b.SubscriberKey) AS FLOAT) /
                    COUNT(DISTINCT s.SubscriberKey) * 100, 2)
         ELSE 0 END                                     AS BounceRate,
    GETDATE()                                           AS ReportDate
FROM
    [_Job] j
LEFT JOIN [_Sent]      s    ON j.JobID = s.JobID
LEFT JOIN [_Open]      o    ON j.JobID = o.JobID AND o.IsUnique = 1
LEFT JOIN [_Click]     c    ON j.JobID = c.JobID AND c.IsUnique = 1
LEFT JOIN [_Bounce]    b    ON j.JobID = b.JobID
LEFT JOIN [_Unsubscribe] u  ON j.JobID = u.JobID
LEFT JOIN [_Complaint] comp ON j.JobID = comp.JobID
WHERE
    j.SendDate >= DATEADD(DAY, -90, GETDATE())
GROUP BY
    j.JobID,
    j.EmailName,
    j.FromName,
    j.SendDate,
    j.Category
ORDER BY
    j.SendDate DESC


-- ============================================================
-- 2. WEEKLY EMAIL PERFORMANCE TREND
-- ============================================================
-- Rolls up performance metrics by ISO week number.
-- Useful for spotting seasonal or week-over-week trends.
-- Output: WeeklyPerformanceTrend_DE
-- Schedule: Weekly (Monday)
-- ============================================================
SELECT
    DATEPART(YEAR, j.SendDate)                           AS SendYear,
    DATEPART(WEEK, j.SendDate)                           AS SendWeek,
    DATEADD(DAY, -(DATEPART(WEEKDAY, j.SendDate) - 2),
            CAST(j.SendDate AS DATE))                    AS WeekStartDate,
    COUNT(DISTINCT j.JobID)                              AS NumberOfSends,
    SUM(cnt_sent.SentCount)                              AS TotalSent,
    SUM(cnt_open.OpenCount)                              AS TotalUniqueOpens,
    SUM(cnt_click.ClickCount)                            AS TotalUniqueClicks,
    ROUND(
        CAST(SUM(cnt_open.OpenCount) AS FLOAT) /
        NULLIF(SUM(cnt_sent.SentCount), 0) * 100
    , 2)                                                 AS AvgOpenRate,
    ROUND(
        CAST(SUM(cnt_click.ClickCount) AS FLOAT) /
        NULLIF(SUM(cnt_sent.SentCount), 0) * 100
    , 2)                                                 AS AvgClickRate
FROM
    [_Job] j
LEFT JOIN (
    SELECT JobID, COUNT(*) AS SentCount
    FROM [_Sent] GROUP BY JobID
) cnt_sent ON j.JobID = cnt_sent.JobID
LEFT JOIN (
    SELECT JobID, COUNT(*) AS OpenCount
    FROM [_Open] WHERE IsUnique = 1 GROUP BY JobID
) cnt_open ON j.JobID = cnt_open.JobID
LEFT JOIN (
    SELECT JobID, COUNT(*) AS ClickCount
    FROM [_Click] WHERE IsUnique = 1 GROUP BY JobID
) cnt_click ON j.JobID = cnt_click.JobID
WHERE
    j.SendDate >= DATEADD(DAY, -365, GETDATE())
GROUP BY
    DATEPART(YEAR, j.SendDate),
    DATEPART(WEEK, j.SendDate),
    DATEADD(DAY, -(DATEPART(WEEKDAY, j.SendDate) - 2), CAST(j.SendDate AS DATE))
ORDER BY
    SendYear, SendWeek


-- ============================================================
-- 3. LINK CLICK PERFORMANCE (Top URLs per Campaign)
-- ============================================================
-- Shows which URLs got the most clicks in a given send.
-- Output: LinkClickPerformance_DE
-- Schedule: Daily
-- ============================================================
SELECT
    c.JobID,
    j.EmailName,
    j.SendDate,
    c.URL,
    c.LinkName,
    COUNT(*)                                AS TotalClicks,
    COUNT(DISTINCT c.SubscriberKey)         AS UniqueClicks,
    RANK() OVER (
        PARTITION BY c.JobID
        ORDER BY COUNT(DISTINCT c.SubscriberKey) DESC
    )                                       AS ClickRank
FROM
    [_Click] c
INNER JOIN [_Job] j ON c.JobID = j.JobID
WHERE
    j.SendDate >= DATEADD(DAY, -30, GETDATE())
    AND c.URL NOT LIKE '%unsub%'        -- exclude unsubscribe links
    AND c.URL NOT LIKE '%preference%'   -- exclude preference center
GROUP BY
    c.JobID,
    j.EmailName,
    j.SendDate,
    c.URL,
    c.LinkName
ORDER BY
    j.SendDate DESC,
    UniqueClicks DESC


-- ============================================================
-- 4. SUBSCRIBER GROWTH & CHURN REPORT
-- ============================================================
-- Tracks net subscriber growth (new opts-in minus opt-outs)
-- over a rolling 12-month period.
-- Output: SubscriberGrowth_DE
-- Schedule: Monthly (1st of month)
-- ============================================================
WITH MonthlyOptIns AS (
    SELECT
        DATEPART(YEAR, DateJoined)   AS JoinYear,
        DATEPART(MONTH, DateJoined)  AS JoinMonth,
        COUNT(*)                     AS NewSubscribers
    FROM [AllSubscribers_DE]
    WHERE DateJoined >= DATEADD(MONTH, -12, GETDATE())
    GROUP BY DATEPART(YEAR, DateJoined), DATEPART(MONTH, DateJoined)
),
MonthlyOptOuts AS (
    SELECT
        DATEPART(YEAR, EventDate)    AS UnsubYear,
        DATEPART(MONTH, EventDate)   AS UnsubMonth,
        COUNT(*)                     AS Unsubscribes
    FROM [_Unsubscribe]
    WHERE EventDate >= DATEADD(MONTH, -12, GETDATE())
    GROUP BY DATEPART(YEAR, EventDate), DATEPART(MONTH, EventDate)
),
MonthlyBounces AS (
    SELECT
        DATEPART(YEAR, EventDate)    AS BounceYear,
        DATEPART(MONTH, EventDate)   AS BounceMonth,
        COUNT(DISTINCT SubscriberKey) AS HardBounces
    FROM [_Bounce]
    WHERE BounceCategory = 'hard'
      AND EventDate >= DATEADD(MONTH, -12, GETDATE())
    GROUP BY DATEPART(YEAR, EventDate), DATEPART(MONTH, EventDate)
)
SELECT
    o.JoinYear                              AS ReportYear,
    o.JoinMonth                             AS ReportMonth,
    o.NewSubscribers,
    COALESCE(u.Unsubscribes, 0)             AS Unsubscribes,
    COALESCE(b.HardBounces, 0)              AS HardBounces,
    o.NewSubscribers
        - COALESCE(u.Unsubscribes, 0)
        - COALESCE(b.HardBounces, 0)        AS NetGrowth
FROM
    MonthlyOptIns o
LEFT JOIN MonthlyOptOuts u  ON o.JoinYear = u.UnsubYear
                           AND o.JoinMonth = u.UnsubMonth
LEFT JOIN MonthlyBounces b  ON o.JoinYear = b.BounceYear
                           AND o.JoinMonth = b.BounceMonth
ORDER BY
    ReportYear, ReportMonth


-- ============================================================
-- 5. A/B TEST RESULTS COMPARISON
-- ============================================================
-- Compare performance between Subject Line A and B variants.
-- Assumes you use a naming convention like:
--   "Campaign Name - Variant A" and "Campaign Name - Variant B"
-- Output: ABTestResults_DE
-- ============================================================
SELECT
    REPLACE(REPLACE(j.EmailName, ' - Variant A',''), ' - Variant B','') AS CampaignName,
    CASE WHEN j.EmailName LIKE '% - Variant A' THEN 'A'
         WHEN j.EmailName LIKE '% - Variant B' THEN 'B'
         ELSE 'Control' END                             AS Variant,
    j.EmailName                                         AS FullEmailName,
    j.SendDate,
    COUNT(DISTINCT s.SubscriberKey)                     AS SampleSize,
    COUNT(DISTINCT o.SubscriberKey)                     AS UniqueOpens,
    COUNT(DISTINCT c.SubscriberKey)                     AS UniqueClicks,
    ROUND(CAST(COUNT(DISTINCT o.SubscriberKey) AS FLOAT) /
          NULLIF(COUNT(DISTINCT s.SubscriberKey), 0) * 100, 2) AS OpenRate,
    ROUND(CAST(COUNT(DISTINCT c.SubscriberKey) AS FLOAT) /
          NULLIF(COUNT(DISTINCT s.SubscriberKey), 0) * 100, 2) AS ClickRate,
    ROUND(CAST(COUNT(DISTINCT c.SubscriberKey) AS FLOAT) /
          NULLIF(COUNT(DISTINCT o.SubscriberKey), 0) * 100, 2) AS ClickToOpenRate
FROM
    [_Job] j
LEFT JOIN [_Sent]  s  ON j.JobID = s.JobID
LEFT JOIN [_Open]  o  ON j.JobID = o.JobID AND o.IsUnique = 1
LEFT JOIN [_Click] c  ON j.JobID = c.JobID AND c.IsUnique = 1
WHERE
    (j.EmailName LIKE '% - Variant A' OR j.EmailName LIKE '% - Variant B')
    AND j.SendDate >= DATEADD(DAY, -180, GETDATE())
GROUP BY
    j.EmailName, j.SendDate
ORDER BY
    CampaignName, j.SendDate, Variant


-- ============================================================
-- 6. REVENUE ATTRIBUTION BY EMAIL (requires OrderData DE)
-- ============================================================
-- Attributes revenue from purchases made within 7 days of
-- clicking an email. Requires an OrderData DE with:
--   OrderID, CustomerEmail, OrderTotal, OrderDate
-- Output: EmailRevenueAttribution_DE
-- Schedule: Daily
-- ============================================================
SELECT
    j.JobID,
    j.EmailName,
    j.SendDate,
    COUNT(DISTINCT c.SubscriberKey)             AS UniqueClickers,
    COUNT(DISTINCT p.OrderID)                   AS ConvertedOrders,
    SUM(p.OrderTotal)                           AS TotalRevenue,
    ROUND(SUM(p.OrderTotal) /
          NULLIF(COUNT(DISTINCT c.SubscriberKey), 0), 2)   AS RevenuePerClicker,
    ROUND(SUM(p.OrderTotal) /
          NULLIF(COUNT(DISTINCT s.SubscriberKey), 0), 2)   AS RevenuePerSent
FROM
    [_Job] j
LEFT JOIN [_Sent]  s ON j.JobID = s.JobID
LEFT JOIN [_Click] c ON j.JobID = c.JobID AND c.IsUnique = 1
-- Match clickers to purchases within 7-day attribution window
LEFT JOIN [PurchaseHistory_DE] p
    ON c.SubscriberID = p.CustomerEmail
    AND p.OrderDate BETWEEN c.EventDate AND DATEADD(DAY, 7, c.EventDate)
WHERE
    j.SendDate >= DATEADD(DAY, -90, GETDATE())
GROUP BY
    j.JobID,
    j.EmailName,
    j.SendDate
ORDER BY
    TotalRevenue DESC
