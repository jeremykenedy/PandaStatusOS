#pragma once
#include <stdio.h>
#define ESP_LOGI(tag, ...) do { printf("  [I %s] ", tag); printf(__VA_ARGS__); printf("\n"); } while (0)
#define ESP_LOGW(tag, ...) do { printf("  [W %s] ", tag); printf(__VA_ARGS__); printf("\n"); } while (0)
#define ESP_LOGE(tag, ...) do { printf("  [E %s] ", tag); printf(__VA_ARGS__); printf("\n"); } while (0)
