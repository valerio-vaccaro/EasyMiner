#include <Arduino.h>
#include <WiFi.h>
#include <esp_task_wdt.h>
#include "board_config.h"
#include "mining/miner.h"
#include "stratum/stratum.h"
#include "config/nvs_config.h"
#include "config/wifi_manager.h"
#include "web_dashboard.h"

TaskHandle_t webTask=nullptr;
void setup(){Serial.begin(115200);delay(300);Serial.printf("\n[BOOT] %s Bitcoin miner\n",MINER_NAME);esp_task_wdt_init(30,true);WiFi.setSleep(false);nvs_config_init();miner_init();stratum_init();miner_config_t *c=nvs_config_get();stratum_set_pool(c->poolUrl,c->poolPort,c->wallet,c->poolPassword,c->workerName);stratum_set_backup_pool(c->backupPoolUrl,c->backupPoolPort,c->backupWallet,c->backupPoolPassword,c->workerName);wifi_manager_init();wifi_manager_start();web_dashboard_init();
 if(nvs_config_is_valid())xTaskCreatePinnedToCore(stratum_task,"Stratum",STRATUM_STACK,nullptr,STRATUM_PRIORITY,nullptr,STRATUM_CORE);
 xTaskCreatePinnedToCore(web_dashboard_task,"WebDashboard",8192,nullptr,2,&webTask,CORE_0);
 if(nvs_config_is_valid()){if(c->mineOnCore1)xTaskCreatePinnedToCore(miner_task_core1,"Miner1",MINER_1_STACK,nullptr,MINER_1_PRIORITY,nullptr,MINER_1_CORE);if(c->mineOnCore0)xTaskCreatePinnedToCore(miner_task_core0,"Miner0",MINER_0_STACK,nullptr,MINER_0_PRIORITY,nullptr,MINER_0_CORE);}
 Serial.printf("[READY] %s | WiFi %s | Configure at http://%s/\n",BOARD_NAME,WiFi.SSID().c_str(),wifi_manager_get_ip());}
void loop(){wifi_manager_process();vTaskDelay(pdMS_TO_TICKS(100));}
