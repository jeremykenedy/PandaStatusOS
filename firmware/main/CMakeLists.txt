idf_component_register(
    SRCS "ps_main.c" "ps_cfg.c" "ps_state.c" "ps_ws.c" "ps_wifi.c" "ps_led.c" "ps_effect.c" "ps_printer.c" "ps_ota.c" "ps_backup.c" "ps_api.c" "ps_fx.c" "ps_rebind.c" "ps_diag.c" "ps_netname.c" "ps_log.c" "ps_portal.c" "ps_ssdp.c"
    INCLUDE_DIRS "."
    EMBED_FILES "ui.html.gz" "portal.html"
    REQUIRES nvs_flash esp_http_server esp_app_format esp_wifi esp_netif esp_event mqtt app_update esp_partition driver json esp_timer lwip)

# ui.html is BUILT by tools/ui/build/build.py and committed. Its gzip is derived here on
# every build, with -n so the same input gives byte-identical output, and is gitignored.
find_program(GZIP_EXE gzip REQUIRED)
add_custom_command(
    OUTPUT ${CMAKE_CURRENT_SOURCE_DIR}/ui.html.gz
    COMMAND ${GZIP_EXE} -9 -n -c ${CMAKE_CURRENT_SOURCE_DIR}/ui.html > ${CMAKE_CURRENT_SOURCE_DIR}/ui.html.gz
    DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/ui.html
    VERBATIM)
add_custom_target(ps_ui DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/ui.html.gz)
add_dependencies(${COMPONENT_LIB} ps_ui)
