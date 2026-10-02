#include "web_dashboard.h"

#include <ArduinoJson.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

#include "config/nvs_config.h"
#include "config/wifi_manager.h"
#include "generated_web_assets.h"
#include "mining/miner.h"
#include "stratum/stratum.h"

namespace {

#if defined(ESP32_HEADLESS)
constexpr int STATS_LED_PIN = 2;
#elif defined(ESP32_S3_DEVKIT)
constexpr int STATS_LED_PIN = 48;
#else
constexpr int STATS_LED_PIN = -1;
#endif

constexpr uint32_t STATS_INTERVAL_MS = 10000;

// Chrome opens several HTTP connections together for styles, scripts, images,
// and speculative requests. The Arduino server's default queue holds only four.
class DashboardServer : public WebServer {
public:
    DashboardServer() : WebServer(80) {
        _server = WiFiServer(80, 8);
    }

protected:
    // WiFiClient::write can return a partial write. Send bounded pieces and
    // yield between them instead of silently truncating a large response.
    size_t _currentClientWrite(const char *data, size_t length) override {
        size_t sent = 0;
        uint32_t deadline = millis() + 10000;
        while (sent < length && _currentClient.connected()) {
            const size_t chunk = min(size_t(1024), length - sent);
            const size_t written = _currentClient.write(data + sent, chunk);
            if (written > 0) {
                sent += written;
                deadline = millis() + 10000;
            } else if (int32_t(millis() - deadline) >= 0) {
                break;
            }
            delay(1);
        }
        return sent;
    }

    size_t _currentClientWrite_P(PGM_P data, size_t length) override {
        // ESP32 flash is memory-mapped; the same bounded writer works for both.
        return _currentClientWrite(data, length);
    }
};

DashboardServer server;
WebSocketsServer socket(81);
uint32_t statsLedOffAt = 0;

// Branding affects only the title, logo, and palette. Layout and behavior are
// shared, and the repository attribution always names the EasyMiner project.
struct Brand {
    const char *id;
    const char *name;
    const char *theme;
    bool hasLogo;
};

#if defined(BLOX_VARIANT)
const Brand brand = {"blox", "BLOXMiner",
    "--accent:#c7f36b;--accent-rgb:199,243,107;--button:#c7f36b;--button-text:#101318;", true};
#elif defined(SATOSHI_SPRITZ_VARIANT)
const Brand brand = {"satoshispritz", "SatoshiSpritzMiner",
    "--accent:#ff9f1c;--accent-rgb:255,159,28;--button:#ff9f1c;--button-text:#171717;", true};
#elif defined(OFFICINE_BITCOIN_VARIANT)
const Brand brand = {"officinebitcoin", "OfficineBitcoinMiner",
    "--accent:#ffd21f;--accent-rgb:255,210,31;--button:#ffd21f;--button-text:#17191d;--surface:#24282e;--border:#454b55;", true};
#elif defined(SBAMMINER_VARIANT)
const Brand brand = {"sbamminer", "SBAMminer",
    "--accent:#60a5fa;--accent-rgb:96,165,250;--button:#1e40af;--button-text:#ffffff;", true};
#else
const Brand brand = {"base", "EasyMiner",
    "--accent:#f7931a;--accent-rgb:247,147,26;--button:#f7931a;--button-text:#101318;", false};
#endif

struct TemplateValue {
    const char *name;
    String value;
};

// Substitute only tokens in the original template. A saved setting containing
// "%BRAND%" or another token must stay literal, rather than being substituted.
String fillTemplate(const char *source, const TemplateValue *values, size_t count) {
    String output;
    output.reserve(strlen(source) + 512);
    const char *cursor = source;
    while (*cursor) {
        const char *start = strchr(cursor, '%');
        if (!start) {
            output += cursor;
            break;
        }
        output.concat(cursor, start - cursor);
        const char *end = strchr(start + 1, '%');
        if (!end) {
            output += start;
            break;
        }
        bool found = false;
        for (size_t i = 0; i < count; ++i) {
            const size_t length = strlen(values[i].name);
            if (length == size_t(end - start - 1) && strncmp(start + 1, values[i].name, length) == 0) {
                output += values[i].value;
                found = true;
                break;
            }
        }
        if (!found) output.concat(start, end - start + 1);
        cursor = end + 1;
    }
    return output;
}

template<size_t N>
String fillTemplate(const char *source, const TemplateValue (&values)[N]) {
    return fillTemplate(source, values, N);
}

String escapeHtml(const char *text) {
    String escaped;
    for (const char *cursor = text; *cursor; ++cursor) {
        switch (*cursor) {
            case '&': escaped += "&amp;"; break;
            case '<': escaped += "&lt;"; break;
            case '>': escaped += "&gt;"; break;
            case '"': escaped += "&quot;"; break;
            case '\'': escaped += "&#39;"; break;
            default: escaped += *cursor;
        }
    }
    return escaped;
}

String backgroundMarkup() {
    String background;
    for (int i = 0; i < 6; ++i) {
        background += brand.hasLogo
            ? "<img src=\"/logo.png?v=" AUTO_VERSION "\" alt=\"\" width=\"160\" height=\"160\">"
            : "<span>₿</span>";
    }
    return background;
}

String renderPage(const char *title, const String &content, const char *activePage) {
    const String logo = brand.hasLogo
        ? "<img class=\"brand-logo\" src=\"/logo.png?v=" AUTO_VERSION "\" alt=\"\">"
        : "";
    const TemplateValue values[] = {
        {"TITLE", title}, {"BRAND", brand.name}, {"BRAND_ID", brand.id},
        {"THEME", brand.theme}, {"LOGO", logo}, {"BACKGROUND", backgroundMarkup()},
        {"CONTENT", content}, {"VERSION", AUTO_VERSION},
        {"PAGE_SCRIPT", strcmp(activePage, "about") == 0 || !*activePage ? "" : "<script>%SCRIPT%</script>"},
        {"FAVICON", brand.hasLogo ? "/logo.png?v=" AUTO_VERSION : "/favicon.svg?v=" AUTO_VERSION},
        {"HOME_CURRENT", strcmp(activePage, "home") == 0 ? "aria-current=\"page\"" : ""},
        {"CONFIG_CURRENT", strcmp(activePage, "config") == 0 ? "aria-current=\"page\"" : ""},
        {"ABOUT_CURRENT", strcmp(activePage, "about") == 0 ? "aria-current=\"page\"" : ""},
    };
    return fillTemplate(WEB_LAYOUT, values);
}

String homePage() {
    const TemplateValue values[] = {{"VERSION", AUTO_VERSION}};
    return renderPage(brand.name, fillTemplate(WEB_HOME, values), "home");
}

String configPage() {
    const miner_config_t *config = nvs_config_get();
    const TemplateValue values[] = {
        {"BRAND", brand.name}, {"VERSION", AUTO_VERSION},
        {"SSID", escapeHtml(config->ssid)},
        {"WIFI_PASSWORD", escapeHtml(config->wifiPassword)},
        {"WALLET", escapeHtml(config->wallet)},
        {"WORKER", escapeHtml(config->workerName)},
        {"POOL_HOST", escapeHtml(config->poolUrl)},
        {"POOL_PORT", String(config->poolPort)},
        {"POOL_PASSWORD", escapeHtml(config->poolPassword)},
        {"CORE0", config->mineOnCore0 ? "checked" : ""},
        {"CORE1", config->mineOnCore1 ? "checked" : ""},
    };
    const String title = String(brand.name) + " configuration";
    return renderPage(title.c_str(), fillTemplate(WEB_CONFIG, values), "config");
}

String aboutPage() {
    const TemplateValue values[] = {{"BRAND", brand.name}};
    const String title = String("About ") + brand.name;
    return renderPage(title.c_str(), fillTemplate(WEB_ABOUT, values), "about");
}

String statsJson() {
    const mining_stats_t *stats = miner_get_stats();
    const unsigned long elapsed = max(1UL, millis() - stats->startTime);
    StaticJsonDocument<1536> document;
    JsonObject data = document["stats"].to<JsonObject>();

    data["uptimeSeconds"] = elapsed / 1000;
    data["hashrate"] = uint32_t(double(stats->hashes) * 1000.0 / elapsed);
    data["chipTemperature"] = temperatureRead();
    data["freeHeap"] = ESP.getFreeHeap();
    data["minFreeHeap"] = ESP.getMinFreeHeap();
    data["heapSize"] = ESP.getHeapSize();
    data["cpuMHz"] = ESP.getCpuFreqMHz();
    data["hashes"] = uint64_t(stats->hashes);
    data["shares"] = stats->shares;
    data["accepted"] = stats->accepted;
    data["rejected"] = stats->rejected;
    data["blocks"] = stats->blocks;
    data["templates"] = stats->templates;
    data["bestDifficulty"] = stats->bestDifficulty;
    data["latency"] = stats->avgLatency;
    data["poolConnected"] = stratum_is_connected();
    data["poolDifficulty"] = miner_get_difficulty();
    data["pool"] = stratum_get_pool();
    data["poolName"] = stratum_get_pool();
    data["mining"] = miner_is_running();
    data["core0Active"] = miner_core0_is_active();
    data["core1Active"] = miner_core1_is_active();
    data["ip"] = wifi_manager_get_ip();
    data["rssi"] = WiFi.RSSI();
    data["wallet"] = nvs_config_get()->wallet;
    data["flashSize"] = ESP.getFlashChipSize();

    String output;
    serializeJson(document, output);
    return output;
}

void sendPage(const String &page, const char *script = nullptr, size_t scriptLength = 0) {
    // Configuration responses contain saved settings; never cache them.
    server.sendHeader("Cache-Control", "no-store");
    // Only expand the stylesheet in the head and the final script marker.
    // Marker-like text in saved input values remains literal.
    const size_t styleStart = page.indexOf("%STYLE%");
    const size_t styleEnd = styleStart + strlen("%STYLE%");
    const size_t scriptStart = script ? page.lastIndexOf("%SCRIPT%") : page.length();
    const size_t scriptEnd = script ? scriptStart + strlen("%SCRIPT%") : page.length();
    const size_t length = page.length() - (styleEnd - styleStart) - (scriptEnd - scriptStart)
        + sizeof(WEB_STYLE) - 1 + scriptLength;

    server.setContentLength(length);
    server.send(200, "text/html; charset=utf-8", "");
    server.sendContent(page.c_str(), styleStart);
    server.sendContent_P(WEB_STYLE, sizeof(WEB_STYLE) - 1);
    server.sendContent(page.c_str() + styleEnd, scriptStart - styleEnd);
    if (script) {
        server.sendContent_P(script, scriptLength);
        server.sendContent(page.c_str() + scriptEnd, page.length() - scriptEnd);
    }
}

void sendAsset(const char *type, const char *data, size_t length) {
    // Asset URLs include the firmware version. Revalidate unversioned URLs
    // when switching brands on the same device.
    server.sendHeader("Cache-Control", "no-cache");
    server.send_P(200, type, data, length);
}

void registerAssets() {
    server.on("/favicon.svg", HTTP_GET, [] {
        sendAsset("image/svg+xml; charset=utf-8", WEB_FAVICON, sizeof(WEB_FAVICON) - 1);
    });
    server.on("/favicon.ico", HTTP_GET, [] {
        server.sendHeader("Location", "/favicon.svg");
        server.send(302, "text/plain", "");
    });
#if defined(BLOX_VARIANT) || defined(OFFICINE_BITCOIN_VARIANT) || defined(SATOSHI_SPRITZ_VARIANT) || defined(SBAMMINER_VARIANT)
    server.on("/logo.png", HTTP_GET, [] {
        sendAsset("image/png", reinterpret_cast<const char *>(WEB_LOGO), sizeof(WEB_LOGO));
    });
#endif
}

void copyField(char *destination, size_t size, const char *name) {
    const String value = server.hasArg(name) ? server.arg(name) : String();
    strncpy(destination, value.c_str(), size - 1);
    destination[size - 1] = '\0';
}

void scheduleReboot(const char *message) {
    const String content = String("<section class=\"panel\"><h1>") + message
        + "</h1><p>Reconnecting to the miner shortly...</p></section>"
          "<script>setTimeout(() => location.replace('/'), 5000);</script>";
    sendPage(renderPage(brand.name, content, ""));
    delay(250);
    ESP.restart();
}

void saveConfig() {
    const long port = server.arg("pool_port").toInt();
    if (port < 1 || port > 65535) {
        server.send(400, "text/plain; charset=utf-8", "Pool port must be between 1 and 65535.");
        return;
    }
    miner_config_t *config = nvs_config_get();
    copyField(config->ssid, sizeof(config->ssid), "ssid");
    copyField(config->wifiPassword, sizeof(config->wifiPassword), "wifi_password");
    copyField(config->wallet, sizeof(config->wallet), "wallet");
    copyField(config->workerName, sizeof(config->workerName), "worker");
    copyField(config->poolUrl, sizeof(config->poolUrl), "pool_url");
    copyField(config->poolPassword, sizeof(config->poolPassword), "pool_pass");
    config->poolPort = uint16_t(port);
    config->mineOnCore0 = server.hasArg("core0");
    config->mineOnCore1 = server.hasArg("core1");
    nvs_config_save(config);
    scheduleReboot("Saved. Rebooting...");
}

void deleteConfig() {
    Preferences preferences;
    preferences.begin("easyminer", false);
    preferences.clear();
    preferences.end();
    WiFi.disconnect(true, true);
    scheduleReboot("Configuration deleted. Rebooting...");
}

void onSocket(uint8_t client, WStype_t type, uint8_t *, size_t) {
    if (type == WStype_CONNECTED) {
        String payload = statsJson();
        socket.sendTXT(client, payload);
    }
}

void flashStatsLed() {
    if (STATS_LED_PIN < 0) return;
    digitalWrite(STATS_LED_PIN, HIGH);
    statsLedOffAt = millis() + 120;
}

void updateStatsLed() {
    if (STATS_LED_PIN >= 0 && statsLedOffAt && int32_t(millis() - statsLedOffAt) >= 0) {
        digitalWrite(STATS_LED_PIN, LOW);
        statsLedOffAt = 0;
    }
}

} // namespace

void web_dashboard_init() {
    if (STATS_LED_PIN >= 0) {
        pinMode(STATS_LED_PIN, OUTPUT);
        digitalWrite(STATS_LED_PIN, LOW);
    }
    registerAssets();
    server.on("/", HTTP_GET, [] { sendPage(homePage(), WEB_DASHBOARD_JS, sizeof(WEB_DASHBOARD_JS) - 1); });
    server.on("/config", HTTP_GET, [] { sendPage(configPage(), WEB_CONFIG_JS, sizeof(WEB_CONFIG_JS) - 1); });
    server.on("/about", HTTP_GET, [] { sendPage(aboutPage()); });
    server.on("/api/stats", HTTP_GET, [] {
        server.sendHeader("Cache-Control", "no-store");
        server.send(200, "application/json; charset=utf-8", statsJson());
    });
    server.on("/config", HTTP_POST, saveConfig);
    server.on("/config/delete", HTTP_POST, deleteConfig);
    server.on("/reboot", HTTP_POST, [] { scheduleReboot("Rebooting..."); });
    server.begin();
    socket.begin();
    socket.onEvent(onSocket);
    Serial.println("[WEB] Dashboard: http://<device-ip>/ (configure at /config)");
}

void web_dashboard_task(void *) {
    uint32_t lastBroadcast = 0;
    for (;;) {
        server.handleClient();
        socket.loop();
        updateStatsLed();
        if (millis() - lastBroadcast >= STATS_INTERVAL_MS) {
            String payload = statsJson();
            socket.broadcastTXT(payload);
            flashStatsLed();
            lastBroadcast = millis();
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
