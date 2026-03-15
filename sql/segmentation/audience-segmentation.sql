-- ============================================================
-- SFMC Automation Studio — Audience Segmentation SQL Queries
-- ============================================================
-- These queries run against SFMC Data Extensions.
-- Schedule in Automation Studio as SQL Activity steps.
-- Output to a target Data Extension before use in sends.
-- ============================================================


-- ============================================================
-- 1. ACTIVE SUBSCRIBERS (Opened or Clicked in Last 90 Days)
-- ============================================================
-- Output DE fields: SubscriberKey, EmailAddress, LastOpenDate,
--                   LastClickDate, EngagementType
-- Schedule: Daily
-- ============================================================
SELECT DISTINCT
    s.SubscriberKey,
    s.EmailAddress,
    s.FirstName,
    s.LastName,
    MAX(o.EventDate) AS LastOpenDate,
    MAX(c.EventDate) AS LastClickDate,
    CASE
        WHEN MAX(c.EventDate) >= DATEADD(DAY, -90, GETDATE()) THEN 'Clicker'
        WHEN MAX(o.EventDate) >= DATEADD(DAY, -90, GETDATE()) THEN 'Opener'
        ELSE 'Unknown'
    END AS EngagementType
FROM
    [AllSubscribers_DE] s
LEFT JOIN
    [_Open] o ON s.SubscriberKey = o.SubscriberKey
             AND o.EventDate >= DATEADD(DAY, -90, GETDATE())
             AND o.IsUnique = 1
LEFT JOIN
    [_Click] c ON s.SubscriberKey = c.SubscriberKey
              AND c.EventDate >= DATEADD(DAY, -90, GETDATE())
              AND c.IsUnique = 1
WHERE
    s.Status = 'Active'
    AND (o.SubscriberKey IS NOT NULL OR c.SubscriberKey IS NOT NULL)
GROUP BY
    s.SubscriberKey,
    s.EmailAddress,
    s.FirstName,
    s.LastName


-- ============================================================
-- 2. ROLLING 90-DAY ENGAGEMENT SCORE
-- ============================================================
-- Scoring: Open = 1 pt, Click = 3 pts, Purchase = 10 pts
-- Recency multiplier: events in last 30 days × 1.5
-- Output: EngagementScores DE
-- Schedule: Nightly
-- ============================================================
SELECT
    s.SubscriberKey,
    s.EmailAddress,
    CAST(
        ROUND(
            (
                COALESCE(opens_recent.OpenCount, 0) * 1 * 1.5 +
                COALESCE(opens_old.OpenCount, 0) * 1 +
                COALESCE(clicks_recent.ClickCount, 0) * 3 * 1.5 +
                COALESCE(clicks_old.ClickCount, 0) * 3 +
                COALESCE(purchases.PurchaseCount, 0) * 10
            )
        , 0)
    AS INT) AS Score,
    GETDATE() AS ScoreDate
FROM
    [AllSubscribers_DE] s
-- Opens in last 30 days (recency bonus)
LEFT JOIN (
    SELECT SubscriberKey, COUNT(*) AS OpenCount
    FROM [_Open]
    WHERE EventDate >= DATEADD(DAY, -30, GETDATE()) AND IsUnique = 1
    GROUP BY SubscriberKey
) opens_recent ON s.SubscriberKey = opens_recent.SubscriberKey
-- Opens 31–90 days ago
LEFT JOIN (
    SELECT SubscriberKey, COUNT(*) AS OpenCount
    FROM [_Open]
    WHERE EventDate BETWEEN DATEADD(DAY, -90, GETDATE()) AND DATEADD(DAY, -31, GETDATE())
      AND IsUnique = 1
    GROUP BY SubscriberKey
) opens_old ON s.SubscriberKey = opens_old.SubscriberKey
-- Clicks in last 30 days (recency bonus)
LEFT JOIN (
    SELECT SubscriberKey, COUNT(*) AS ClickCount
    FROM [_Click]
    WHERE EventDate >= DATEADD(DAY, -30, GETDATE()) AND IsUnique = 1
    GROUP BY SubscriberKey
) clicks_recent ON s.SubscriberKey = clicks_recent.SubscriberKey
-- Clicks 31–90 days ago
LEFT JOIN (
    SELECT SubscriberKey, COUNT(*) AS ClickCount
    FROM [_Click]
    WHERE EventDate BETWEEN DATEADD(DAY, -90, GETDATE()) AND DATEADD(DAY, -31, GETDATE())
      AND IsUnique = 1
    GROUP BY SubscriberKey
) clicks_old ON s.SubscriberKey = clicks_old.SubscriberKey
-- Purchases (from transactional DE)
LEFT JOIN (
    SELECT CustomerEmail, COUNT(*) AS PurchaseCount
    FROM [PurchaseHistory_DE]
    WHERE OrderDate >= DATEADD(DAY, -90, GETDATE())
    GROUP BY CustomerEmail
) purchases ON s.EmailAddress = purchases.CustomerEmail
WHERE
    s.Status = 'Active'


-- ============================================================
-- 3. INACTIVE SUBSCRIBERS FOR WIN-BACK JOURNEY
-- ============================================================
-- Identify subscribers who haven't opened/clicked in 60–180 days
-- and have NOT hard bounced or unsubscribed.
-- Output: InactiveSubscribers DE (used by re-engagement journey)
-- Schedule: Weekly (Monday 6 AM)
-- ============================================================
SELECT
    s.SubscriberKey,
    s.EmailAddress,
    s.FirstName,
    s.LastName,
    MAX(engagement.EventDate)   AS LastEngagementDate,
    DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) AS DaysSinceEngagement,
    CASE
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 60  AND 74  THEN 1
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 75  AND 89  THEN 2
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 90  AND 104 THEN 3
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 105 AND 119 THEN 4
        ELSE 5
    END AS WinbackStep,
    CASE
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 60  AND 74  THEN NULL
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 75  AND 89  THEN 'WINBACK10'
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 90  AND 104 THEN 'WINBACK20'
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 105 AND 119 THEN 'FREESHIP'
        ELSE 'MYSTERYGIFT'
    END AS OfferCode,
    CASE
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 60  AND 74  THEN NULL
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 75  AND 89  THEN '10% Off'
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 90  AND 104 THEN '20% Off'
        WHEN DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 105 AND 119 THEN 'Free Shipping'
        ELSE 'Mystery Gift'
    END AS OfferValue
FROM
    [AllSubscribers_DE] s
-- Combine opens and clicks into one engagement event set
INNER JOIN (
    SELECT SubscriberKey, EventDate FROM [_Open]  WHERE IsUnique = 1
    UNION ALL
    SELECT SubscriberKey, EventDate FROM [_Click] WHERE IsUnique = 1
) engagement ON s.SubscriberKey = engagement.SubscriberKey
WHERE
    s.Status = 'Active'
    AND NOT EXISTS (
        SELECT 1 FROM [_Bounce]
        WHERE SubscriberKey = s.SubscriberKey AND BounceCategory = 'hard'
    )
GROUP BY
    s.SubscriberKey,
    s.EmailAddress,
    s.FirstName,
    s.LastName
HAVING
    DATEDIFF(DAY, MAX(engagement.EventDate), GETDATE()) BETWEEN 60 AND 180


-- ============================================================
-- 4. HIGH-VALUE CUSTOMER SEGMENT (RFM Scoring)
-- ============================================================
-- RFM = Recency, Frequency, Monetary
-- Score each subscriber 1–5 on each dimension.
-- Output: RFMSegments DE
-- Schedule: Weekly
-- ============================================================
WITH RFM_Base AS (
    SELECT
        CustomerEmail                                               AS EmailAddress,
        DATEDIFF(DAY, MAX(OrderDate), GETDATE())                    AS Recency,
        COUNT(DISTINCT OrderID)                                      AS Frequency,
        SUM(OrderTotal)                                              AS Monetary
    FROM [PurchaseHistory_DE]
    WHERE OrderDate >= DATEADD(YEAR, -2, GETDATE())
    GROUP BY CustomerEmail
),
RFM_Scored AS (
    SELECT
        EmailAddress,
        Recency,
        Frequency,
        Monetary,
        NTILE(5) OVER (ORDER BY Recency ASC)    AS R_Score,   -- lower recency = higher score
        NTILE(5) OVER (ORDER BY Frequency DESC) AS F_Score,
        NTILE(5) OVER (ORDER BY Monetary DESC)  AS M_Score
    FROM RFM_Base
)
SELECT
    s.SubscriberKey,
    r.EmailAddress,
    s.FirstName,
    r.Recency,
    r.Frequency,
    r.Monetary,
    r.R_Score,
    r.F_Score,
    r.M_Score,
    (r.R_Score + r.F_Score + r.M_Score)         AS RFM_Total,
    CASE
        WHEN r.R_Score >= 4 AND r.F_Score >= 4 AND r.M_Score >= 4 THEN 'Champions'
        WHEN r.R_Score >= 3 AND r.F_Score >= 3                     THEN 'Loyal Customers'
        WHEN r.R_Score >= 4 AND r.F_Score <= 2                     THEN 'New Customers'
        WHEN r.R_Score <= 2 AND r.F_Score >= 4 AND r.M_Score >= 4  THEN 'At-Risk High Value'
        WHEN r.R_Score <= 2 AND r.F_Score >= 3                     THEN 'Needs Attention'
        WHEN r.R_Score <= 2 AND r.F_Score <= 2 AND r.M_Score <= 2  THEN 'Hibernating'
        WHEN r.R_Score >= 3 AND r.M_Score >= 4                     THEN 'Potential Loyalist'
        ELSE 'Others'
    END AS RFM_Segment,
    GETDATE() AS SegmentDate
FROM
    RFM_Scored r
INNER JOIN [AllSubscribers_DE] s ON r.EmailAddress = s.EmailAddress
WHERE s.Status = 'Active'


-- ============================================================
-- 5. NEW SUBSCRIBER ONBOARDING SEQUENCE POPULATION
-- ============================================================
-- Identifies brand new subscribers (opted in within last 24 h)
-- and seeds them into the WelcomeSubscribers DE.
-- Schedule: Every 4 hours via Automation Studio
-- ============================================================
SELECT
    s.SubscriberKey,
    s.EmailAddress,
    s.FirstName,
    s.LastName,
    COALESCE(s.PreferredCategory, 'General') AS PreferredCategory,
    'N'                                       AS HasCompletedProfile,
    'N'                                       AS HasMadeFirstPurchase,
    'N'                                       AS HasDownloadedApp,
    'WELCOME15'                               AS WelcomeOfferCode,
    GETDATE()                                 AS EnrollmentDate
FROM
    [AllSubscribers_DE] s
WHERE
    s.Status = 'Active'
    AND s.DateJoined >= DATEADD(HOUR, -4, GETDATE())
    AND NOT EXISTS (
        SELECT 1 FROM [WelcomeSubscribers] w
        WHERE w.EmailAddress = s.EmailAddress
    )


-- ============================================================
-- 6. SMART SUPPRESSION LIST (Auto-Updated)
-- ============================================================
-- Excludes: hard bounces, spam complaints, long-term inactives
-- (365+ days), recent unsubscribes.
-- Best practice: Reference this DE as a suppression list on
-- every send, not just win-back.
-- Schedule: Daily
-- ============================================================
SELECT DISTINCT
    s.SubscriberKey,
    s.EmailAddress,
    CASE
        WHEN b.SubscriberKey IS NOT NULL     THEN 'HardBounce'
        WHEN c.SubscriberKey IS NOT NULL     THEN 'SpamComplaint'
        WHEN s.Status = 'Unsubscribed'       THEN 'Unsubscribed'
        WHEN last_eng.LastEvent IS NULL
          OR DATEDIFF(DAY, last_eng.LastEvent, GETDATE()) > 365
                                             THEN 'LongTermInactive'
        ELSE 'Other'
    END AS SuppressionReason,
    GETDATE() AS SuppressedDate
FROM
    [AllSubscribers_DE] s
-- Hard bounces
LEFT JOIN (
    SELECT DISTINCT SubscriberKey
    FROM [_Bounce]
    WHERE BounceCategory = 'hard'
) b ON s.SubscriberKey = b.SubscriberKey
-- Spam complaints
LEFT JOIN (
    SELECT DISTINCT SubscriberKey
    FROM [_Complaint]
) c ON s.SubscriberKey = c.SubscriberKey
-- Last engagement event
LEFT JOIN (
    SELECT SubscriberKey, MAX(EventDate) AS LastEvent
    FROM (
        SELECT SubscriberKey, EventDate FROM [_Open]  WHERE IsUnique = 1
        UNION ALL
        SELECT SubscriberKey, EventDate FROM [_Click] WHERE IsUnique = 1
    ) all_events
    GROUP BY SubscriberKey
) last_eng ON s.SubscriberKey = last_eng.SubscriberKey
WHERE
    b.SubscriberKey IS NOT NULL
    OR c.SubscriberKey IS NOT NULL
    OR s.Status = 'Unsubscribed'
    OR last_eng.LastEvent IS NULL
    OR DATEDIFF(DAY, last_eng.LastEvent, GETDATE()) > 365
