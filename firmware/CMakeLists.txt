# Panda Status P2 clone. ESP-IDF v5.3.1 to match the factory build; target esp32c3.
#   . ~/esp/esp-idf/export.sh && idf.py set-target esp32c3 && idf.py build
# Nothing here flashes. Flashing is standing rule 0: explicit, per message, cable in hand.
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(panda_status)
