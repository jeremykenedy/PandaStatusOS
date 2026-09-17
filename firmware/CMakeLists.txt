# PandaStatusOS: a clean-room firmware for the Panda Status P2. ESP-IDF v5.3.1 to match the
# factory build; target esp32c3. The project name here is what esp_app_desc reports.
#   . ~/esp/esp-idf/export.sh && idf.py set-target esp32c3 && idf.py build
# Nothing here flashes. Flashing is the flashing rule in SAFETY.md: explicit, per message.
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(pandastatusos)
