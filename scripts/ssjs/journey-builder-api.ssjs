/**
 * SFMC Journey Builder REST API Helper (SSJS)
 * =============================================
 * Server-Side JavaScript for use in SFMC CloudPages or Script Activities.
 * Provides helpers for programmatic Journey Build automation:
 *   - Fetch journey definitions
 *   - Create / update journeys via the REST API
 *   - Trigger journey entry events via the Events API
 *   - Pause / resume / stop journeys
 *   - Export journey metrics
 *
 * IMPORTANT: Replace placeholder values (CLIENT_ID, CLIENT_SECRET, etc.)
 *            with your SFMC API credentials. Use Installed Package credentials
 *            stored as Data Extension values — never hardcode them.
 *
 * Reference:
 *   https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/journey-spec.html
 */

<script runat="server">

Platform.Load("Core","1.1.5");

/* ============================================================
   CONFIG  — Pull from a secure Config Data Extension
   DE fields: ConfigKey (PK), ConfigValue
   ============================================================ */
var CONFIG_DE      = "SFMC_API_Config";
var clientId       = Lookup(CONFIG_DE, "ConfigValue", "ConfigKey", "CLIENT_ID");
var clientSecret   = Lookup(CONFIG_DE, "ConfigValue", "ConfigKey", "CLIENT_SECRET");
var accountId      = Lookup(CONFIG_DE, "ConfigValue", "ConfigKey", "MID");
var subdomain      = Lookup(CONFIG_DE, "ConfigValue", "ConfigKey", "AUTH_SUBDOMAIN");  // e.g. "abc123"

var AUTH_URL       = "https://" + subdomain + ".auth.marketingcloudapis.com/v2/token";
var REST_BASE      = "https://" + subdomain + ".rest.marketingcloudapis.com";
var JB_API_BASE    = REST_BASE + "/interaction/v1";

/* ============================================================
   1. GET ACCESS TOKEN
   ============================================================ */
function getAccessToken() {
  var payload = {
    grant_type:    "client_credentials",
    client_id:     clientId,
    client_secret: clientSecret,
    account_id:    accountId
  };

  var req  = new Script.Util.HttpRequest(AUTH_URL);
  req.method      = "POST";
  req.contentType = "application/json";
  req.postData    = Stringify(payload);

  var resp = req.send();
  if (resp.statusCode !== 200) {
    throw new Error("Auth failed: " + resp.statusCode + " – " + resp.content);
  }

  var body = Platform.Function.ParseJSON(resp.content);
  return body.access_token;
}

/* ============================================================
   2. GENERIC REST HELPER
   ============================================================ */
function sfmcRequest(method, endpoint, accessToken, body) {
  var url = JB_API_BASE + endpoint;
  var req = new Script.Util.HttpRequest(url);
  req.method = method.toUpperCase();
  req.setHeader("Authorization", "Bearer " + accessToken);
  req.setHeader("Content-Type", "application/json");
  if (body) {
    req.postData = Stringify(body);
  }

  var resp = req.send();
  var parsed = null;
  try {
    parsed = Platform.Function.ParseJSON(resp.content);
  } catch(e) {
    parsed = { rawContent: resp.content };
  }
  return { statusCode: resp.statusCode, body: parsed };
}

/* ============================================================
   3. LIST ALL JOURNEYS
   Supports pagination via $pageSize and $page parameters.
   ============================================================ */
function listJourneys(accessToken, page, pageSize) {
  page     = page     || 1;
  pageSize = pageSize || 50;
  var endpoint = "/interactions?$pageSize=" + pageSize + "&$page=" + page;
  var result   = sfmcRequest("GET", endpoint, accessToken);
  return result.body;
}

/* ============================================================
   4. GET A JOURNEY BY KEY
   ============================================================ */
function getJourneyByKey(accessToken, journeyKey) {
  var endpoint = "/interactions/key:" + journeyKey;
  var result   = sfmcRequest("GET", endpoint, accessToken);
  if (result.statusCode !== 200) {
    throw new Error("Journey not found: " + journeyKey + " (" + result.statusCode + ")");
  }
  return result.body;
}

/* ============================================================
   5. CREATE A JOURNEY (Draft)
   journeyConfig: a JavaScript object matching the journey schema
   ============================================================ */
function createJourney(accessToken, journeyConfig) {
  var result = sfmcRequest("POST", "/interactions", accessToken, journeyConfig);
  if (result.statusCode !== 200 && result.statusCode !== 201) {
    throw new Error("Create journey failed: " + result.statusCode + " – " + Stringify(result.body));
  }
  return result.body;
}

/* ============================================================
   6. UPDATE A JOURNEY (must be in Draft status)
   ============================================================ */
function updateJourney(accessToken, journeyId, journeyVersion, journeyConfig) {
  var endpoint = "/interactions/id:" + journeyId + "?versionNumber=" + journeyVersion;
  var result   = sfmcRequest("PUT", endpoint, accessToken, journeyConfig);
  if (result.statusCode !== 200) {
    throw new Error("Update journey failed: " + result.statusCode + " – " + Stringify(result.body));
  }
  return result.body;
}

/* ============================================================
   7. PUBLISH A JOURNEY (move from Draft to Active)
   ============================================================ */
function publishJourney(accessToken, journeyId, journeyVersion) {
  var endpoint = "/interactions/publishAsync/id:" + journeyId + "?versionNumber=" + journeyVersion;
  var result   = sfmcRequest("POST", endpoint, accessToken, {});
  if (result.statusCode !== 200 && result.statusCode !== 201) {
    throw new Error("Publish journey failed: " + result.statusCode + " – " + Stringify(result.body));
  }
  return result.body;
}

/* ============================================================
   8. PAUSE A JOURNEY (Active → Paused)
   ============================================================ */
function pauseJourney(accessToken, journeyId, journeyVersion) {
  var endpoint = "/interactions/pause/id:" + journeyId + "?versionNumber=" + journeyVersion;
  var result   = sfmcRequest("POST", endpoint, accessToken, {});
  return result;
}

/* ============================================================
   9. RESUME A JOURNEY (Paused → Active)
   ============================================================ */
function resumeJourney(accessToken, journeyId, journeyVersion) {
  var endpoint = "/interactions/resume/id:" + journeyId + "?versionNumber=" + journeyVersion;
  var result   = sfmcRequest("POST", endpoint, accessToken, {});
  return result;
}

/* ============================================================
   10. STOP A JOURNEY
   ============================================================ */
function stopJourney(accessToken, journeyId, journeyVersion) {
  var endpoint = "/interactions/stop/id:" + journeyId + "?versionNumber=" + journeyVersion;
  var result   = sfmcRequest("POST", endpoint, accessToken, {});
  return result;
}

/* ============================================================
   11. FIRE A JOURNEY ENTRY EVENT (API Event trigger)
   ============================================================ */
function fireJourneyEvent(accessToken, eventDefinitionKey, contactKey, data) {
  var payload = {
    ContactKey:          contactKey,
    EventDefinitionKey:  eventDefinitionKey,
    Data:                data || {}
  };
  var result = sfmcRequest("POST", "/events", accessToken, payload);
  if (result.statusCode !== 200 && result.statusCode !== 201) {
    throw new Error("Fire event failed: " + result.statusCode + " – " + Stringify(result.body));
  }
  return result.body;
}

/* ============================================================
   12. GET JOURNEY AUDIT LOG (Interaction History)
   ============================================================ */
function getJourneyAuditLog(accessToken, journeyId, journeyVersion) {
  var endpoint = "/interactions/auditLog/id:" + journeyId + "?versionNumber=" + journeyVersion;
  var result   = sfmcRequest("GET", endpoint, accessToken);
  return result.body;
}

/* ============================================================
   13. CHECK CONTACT STATUS IN A JOURNEY
   ============================================================ */
function getContactJourneyStatus(accessToken, journeyKey, contactKey) {
  var endpoint = "/interactions/contactMembership/key:" + journeyKey + "?contactKey=" + contactKey;
  var result   = sfmcRequest("GET", endpoint, accessToken);
  return result.body;
}

/* ============================================================
   14. BULK ENTRY — Fire entry events for multiple contacts
       from a Data Extension
   ============================================================ */
function bulkFireJourneyEntryFromDE(accessToken, eventDefinitionKey, dataExtensionName, maxContacts) {
  maxContacts = maxContacts || 100;
  var de      = DataExtension.Init(dataExtensionName);
  var rows    = de.Rows.Retrieve({ Property: "EntryStatus", SimpleOperator: "equals", Value: "Pending" });
  var count   = 0;
  var errors  = [];

  for (var i = 0; i < rows.length && count < maxContacts; i++) {
    var row        = rows[i];
    var contactKey = row["SubscriberKey"] || row["EmailAddress"];
    var data       = {
      EmailAddress: row["EmailAddress"] || "",
      FirstName:    row["FirstName"]    || "",
      LastName:     row["LastName"]     || ""
    };
    try {
      fireJourneyEvent(accessToken, eventDefinitionKey, contactKey, data);
      de.Rows.Update({ EntryStatus: "Entered" }, ["SubscriberKey"], [contactKey]);
      count++;
    } catch(e) {
      errors.push({ contactKey: contactKey, error: e.message });
      de.Rows.Update({ EntryStatus: "Error" }, ["SubscriberKey"], [contactKey]);
    }
  }

  return { entered: count, errors: errors };
}

/* ============================================================
   EXAMPLE USAGE
   (Uncomment and adapt as needed in your CloudPage or Script Activity)
   ============================================================ */

/*
try {
  var token = getAccessToken();

  // List all journeys
  var journeyList = listJourneys(token);
  Write(Stringify(journeyList));

  // Fire a cart abandonment API event for a single contact
  var result = fireJourneyEvent(
    token,
    "APIEvent-CartAbandoned-v2",
    "subscriber_key_12345",
    {
      EmailAddress: "customer@example.com",
      FirstName:    "Jane",
      CartTotal:    "87.50",
      CartURL:      "https://www.yourstore.com/cart/abc123"
    }
  );
  Write(Stringify(result));

  // Bulk fire entry events from a "CartAbandonedQueue" DE
  var bulkResult = bulkFireJourneyEntryFromDE(
    token,
    "APIEvent-CartAbandoned-v2",
    "CartAbandonedQueue",
    200  // max 200 contacts per run
  );
  Write("Entered: " + bulkResult.entered + " | Errors: " + bulkResult.errors.length);

} catch(e) {
  Write("Error: " + e.message);
}
*/

</script>
