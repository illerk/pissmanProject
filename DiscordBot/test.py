import os
import json

FILE = "characters.json"

print("Проверяем файл:", os.path.abspath(FILE))

# существует ли файл
if os.path.exists(FILE):
    print("Файл существует")
else:
    print("Файл не существует, пробуем создать")

try:
    # пробуем записать
    with open(FILE, "w", encoding="utf-8") as f:
        json.dump({"test": "ok"}, f, ensure_ascii=False, indent=2)

    print("✅ Запись прошла успешно")

except PermissionError as e:
    print("❌ Нет прав на запись:", e)

except Exception as e:
    print("❌ Другая ошибка:", e)