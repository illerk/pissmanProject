# AraBot.py  — обновлённая версия с командами карты и перемещений
import discord
from discord import app_commands
import json
import os
import math
import random
import requests
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
import tempfile
from dotenv import load_dotenv
load_dotenv()

# Файл для хранения персонажей
DATA_FILE = 'characters.json'
MAPS_DIR = "maps"  # папка с картами (png) и json (имя.png + имя.json)

# Загрузка и сохранение персонажей
def load_data():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_data(data):
    temp_file = DATA_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, DATA_FILE)

# ID сервера
GUILD_ID = 1482490630797266995  # Заменить если нужно

# Характеристики
DEFAULT_SKILLS = {
    "Сила": 10,
    "Ловкость": 10,
    "Телосложение": 10,
    "Интеллект": 10,
    "Мудрость": 10,
    "Харизма": 10
}

def calc_modifier(value):
    return math.floor((value - 10) / 2)

def is_valid_url(url: str) -> bool:
    """Проверяет, является ли строка валидным HTTP(S) URL"""
    return url.startswith(("http://", "https://"))

def cache_discord_avatar(url: str, char_name: str, user_id: int) -> str:
    """
    Кэширует Discord CDN изображение локально.
    Если успешно загружено, обновляет image_url и возвращает локальный путь.
    Если ошибка, возвращает None.
    """
    if not url.startswith("https://cdn.discordapp.com"):
        return url  # Не Discord URL, возвращаем как есть
    
    try:
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        
        # Определяем расширение файла
        content_type = resp.headers.get('content-type', 'image/png')
        ext_map = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp',
            'image/gif': '.gif'
        }
        ext = ext_map.get(content_type, '.png')
        
        # Сохраняем локально
        avatars_dir = "avatars"
        os.makedirs(avatars_dir, exist_ok=True)
        
        safe_name = f"{char_name}_discord_{user_id}{ext}"
        avatar_path = os.path.join(avatars_dir, safe_name)
        
        # Сохраняем в файл
        with open(avatar_path, 'wb') as f:
            f.write(resp.content)
        
        print(f"[Cache] Discord URL кэширован: {avatar_path}")
        return avatar_path
    except Exception as e:
        print(f"[Cache] Не удалось кэшировать Discord URL {url}: {e}")
        return None

async def name_autocomplete(interaction: discord.Interaction, current: str):
    try:
        data = load_data()
        if not isinstance(data, dict):
            return []
        return [
            app_commands.Choice(name=name, value=name)
            for name in data
            if current.lower() in name.lower()
        ][:25]
    except Exception as e:
        print(f"[Autocomplete Error] {e}")
        return []
    
async def skill_autocomplete(interaction: discord.Interaction, current: str):
    data = load_data()
    skills = set()

    for char_data in data.values():
        fields = char_data.get("fields", {})
        char_skills = fields.get("Навыки", {})
        if isinstance(char_skills, dict):
            for skill in char_skills.keys():
                skills.add(skill)

    return [
        app_commands.Choice(name=skill, value=skill)
        for skill in sorted(skills) if current.lower() in skill.lower()
    ][:25]

def get_map_names():
    if not os.path.exists(MAPS_DIR):
        return []
    names = []
    for fn in os.listdir(MAPS_DIR):
        if fn.lower().endswith(".png"):
            names.append(os.path.splitext(fn)[0])
    return sorted(names)

async def map_autocomplete(interaction: discord.Interaction, current: str):
    maps = get_map_names()
    return [
        app_commands.Choice(name=m, value=m)
        for m in maps
        if current.lower() in m.lower()
    ][:25]

class MapSelect(discord.ui.Select):
    def __init__(self, bot, options):
        super().__init__(placeholder="Выбери карту...", options=options, min_values=1, max_values=1)
        self.bot = bot

    async def callback(self, interaction: discord.Interaction):
        map_name = self.values[0]
        await interaction.response.defer(ephemeral=False)
        try:
            file_path = await render_map_with_characters(map_name, self.bot)
            # Отправляем файл как attachment
            await interaction.followup.send(file=discord.File(file_path), ephemeral=False)
        except Exception as e:
            await interaction.followup.send(f"Ошибка при формировании карты: {e}", ephemeral=True)

class MapView(discord.ui.View):
    def __init__(self, bot, options):
        super().__init__(timeout=120)
        self.add_item(MapSelect(bot, options))

async def render_map_with_characters(map_name: str, bot: discord.Client) -> str:
    """
    Рисует карту + аватарки персонажей, стоящих на этой карте.
    Возвращает путь к временному PNG файлу.
    """
    maps_dir = MAPS_DIR
    map_img_path = os.path.join(maps_dir, f"{map_name}.png")
    map_json_path = os.path.join(maps_dir, f"{map_name}.json")

    if not os.path.exists(map_img_path):
        raise FileNotFoundError(f"Карта {map_name}.png не найдена в {maps_dir}")
    # Загружаем базовую карту
    base = Image.open(map_img_path).convert("RGBA")
    w, h = base.size
    draw = ImageDraw.Draw(base)

    # Загружаем данные карт (опционально для подписи точек)
    map_data = {}
    if os.path.exists(map_json_path):
        with open(map_json_path, "r", encoding="utf-8") as f:
            map_data = json.load(f)

    # Загружаем персонажей и отрисовываем тех, кто на этой карте
    data = load_data()
    # размер аватарки в пикселях — можно регулировать
    avatar_size = max(32, min(w, h) // 12)

    # Группируем персонажей по точкам (x, y)
    from collections import defaultdict
    point_groups = defaultdict(list)
    for name, ch in data.items():
        loc = ch.get("location")
        if not loc or loc.get("map") != map_name:
            continue
        try:
            x = float(loc.get("x", 0.5))
            y = float(loc.get("y", 0.5))
        except Exception:
            continue
        key = (round(x, 4), round(y, 4))  # округляем для группировки
        point_groups[key].append((name, ch))

    for (x, y), chars in point_groups.items():
        px = int(x * w)
        py = int(y * h)
        n = len(chars)
        # Если несколько персонажей — размещаем их по кругу вокруг точки
        radius = avatar_size // 2 + 6 if n > 1 else 0
        angle_step = 2 * math.pi / n if n > 1 else 0
        for idx, (name, ch) in enumerate(chars):
            if n > 1:
                angle = idx * angle_step
                dx = int(radius * math.cos(angle))
                dy = int(radius * math.sin(angle))
            else:
                dx = 0
                dy = 0
            ax = px + dx
            ay = py + dy

            avatar_img = None
            url = ch.get("image_url", "") or ""
            if url:
                try:
                    if url.startswith("avatars/") and os.path.exists(url):
                        # Локальный файл - загружаем полностью в память
                        try:
                            with open(url, 'rb') as f:
                                avatar_img = Image.open(BytesIO(f.read())).convert("RGBA")
                        except FileNotFoundError:
                            print(f"[Map] Локальный файл не найден: {url}")
                            avatar_img = None
                    else:
                        # URL
                        try:
                            resp = requests.get(url, timeout=20)
                            resp.raise_for_status()
                            avatar_img = Image.open(BytesIO(resp.content)).convert("RGBA")
                        except requests.exceptions.HTTPError as e:
                            if e.response.status_code == 404 and "cdn.discordapp.com" in url:
                                # Discord URL истек - попытаемся кэшировать (если это возможно из render функции)
                                print(f"[Map] Discord URL истек (404): {url}")
                            else:
                                print(f"[Map] HTTP ошибка {e.response.status_code} при загрузке {url}")
                            avatar_img = None
                        except requests.exceptions.Timeout:
                            print(f"[Map] Таймаут при загрузке: {url}")
                            avatar_img = None
                        except requests.exceptions.RequestException as e:
                            print(f"[Map] Ошибка сети при загрузке {url}: {e}")
                            avatar_img = None
                        except Exception as e:
                            print(f"[Map] Ошибка обработки изображения {url}: {e}")
                            avatar_img = None
                except Exception as e:
                    print(f"[Map] Неожиданная ошибка при загрузке аватарки {name}: {e}")
                    avatar_img = None
            if avatar_img:
                avatar_img = avatar_img.resize((avatar_size, avatar_size), Image.LANCZOS)
                mask = Image.new("L", (avatar_size, avatar_size), 0)
                mdraw = ImageDraw.Draw(mask)
                mdraw.ellipse((0,0,avatar_size,avatar_size), fill=255)
                base.paste(avatar_img, (ax - avatar_size//2, ay - avatar_size//2), mask)
            else:
                r = avatar_size//2
                draw.ellipse((ax-r, ay-r, ax+r, ay+r), fill=(220,220,220,255), outline=(0,0,0,200))
                try:
                    fnt = ImageFont.load_default()
                    draw.text((ax-4, ay-5), name[0].upper(), font=fnt, fill=(0,0,0,255))
                except Exception:
                    pass

            # подпись имени (немного смещённая)
            text = name
            try:
                fnt = ImageFont.load_default()
                tw, th = draw.textsize(text, font=fnt)
                tx = ax - tw // 2
                ty = ay + avatar_size//2 + 4
                draw.rectangle((tx-3, ty-1, tx+tw+3, ty+th+1), fill=(0,0,0,150))
                draw.text((tx, ty), text, font=fnt, fill=(255,255,255,255))
            except Exception:
                pass

    # Сохраняем во временный файл и возвращаем путь
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
    tmp_name = tmp.name
    tmp.close()
    base.save(tmp_name, format="PNG")
    return tmp_name

class AraBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        guild = discord.Object(id=GUILD_ID)

        # Роли, которым разрешено создавать и передавать персонажей
        ALLOWED_ROLES = ["arabot-access"]  # Добавьте нужные роли

        def has_admin_or_role(member: discord.Member):
            if member.guild_permissions.administrator:
                return True
            return any(role.name in ALLOWED_ROLES for role in member.roles)

        # Удаляем все команды, включая старые
        print("🧹 Очистка старых команд...")
        self.tree.clear_commands(guild=guild)

        # Удаляем команды с сервера (важно!)
        await self.tree.sync(guild=guild)
        await self.tree.sync()  # глобальный sync на всякий случай

        print("✨ Регистрация новых команд...")

        @self.tree.command(name="char_image_alt", description="Установить аватарку персонажа через файл", guild=guild)
        @app_commands.describe(name="Имя персонажа", image="Файл изображения (attachment)")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_image_alt(interaction: discord.Interaction, name: str, image: discord.Attachment):
                data = load_data()
                if name not in data:
                    await interaction.response.send_message("Персонаж с таким именем не найден.", ephemeral=True)
                    return
                member = await interaction.guild.fetch_member(interaction.user.id)
                if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                    await interaction.response.send_message("Нет прав для изменения аватарки этого персонажа.", ephemeral=True)
                    return
                # Проверяем тип файла
                if not image.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    await interaction.response.send_message("Файл должен быть изображением (.png, .jpg, .jpeg, .webp)", ephemeral=True)
                    return
                # Сохраняем файл в папку avatars
                avatars_dir = "avatars"
                os.makedirs(avatars_dir, exist_ok=True)
                ext = os.path.splitext(image.filename)[1]
                safe_name = f"{name}_{interaction.user.id}{ext}"
                avatar_path = os.path.join(avatars_dir, safe_name)
                try:
                    await image.save(avatar_path)
                except Exception as e:
                    await interaction.response.send_message(f"Ошибка при сохранении файла: {e}", ephemeral=True)
                    return
                # Записываем локальный путь в image_url
                data[name]['image_url'] = avatar_path
                save_data(data)
                await interaction.response.send_message(f"Аватарка для **{name}** установлена из файла.")

        @self.tree.command(name="hello", description="Сказать привет", guild=guild)
        async def say_hello(interaction: discord.Interaction):
            await interaction.response.send_message("Привет-привет!")

        @self.tree.command(name="char_create", description="Создать персонажа", guild=guild)
        @app_commands.describe(name="Имя персонажа")
        async def char_create(interaction: discord.Interaction, name: str):
            member = await interaction.guild.fetch_member(interaction.user.id)
            if not has_admin_or_role(member):
                await interaction.response.send_message("Вы не можете создавать персонажей самостоятельно.", ephemeral=True)
                return
            data = load_data()
            if name in data:
                await interaction.response.send_message(f"Персонаж **{name}** уже существует!", ephemeral=True)
                return
            data[name] = {
                'owner_id': interaction.user.id,
                'show_skills': True,
                'fields': {
                    "Навыки": {skill: DEFAULT_SKILLS[skill] for skill in DEFAULT_SKILLS}
                },
                'image_url': ""
            }
            try:
                save_data(data)
            except PermissionError:
                await interaction.response.send_message("Ошибка доступа к characters.json.", ephemeral=True)
                return
            await interaction.response.send_message(f"Создан персонаж **{name}**!")

        @self.tree.command(name="char_transfer", description="Передать персонажа другому пользователю", guild=guild)
        @app_commands.describe(name="Имя персонажа", new_owner="@Новый владелец (упоминание)")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_transfer(interaction: discord.Interaction, name: str, new_owner: discord.Member):
            member = await interaction.guild.fetch_member(interaction.user.id)
            if not has_admin_or_role(member):
                await interaction.response.send_message("Вы не можете передавать персонажей.", ephemeral=True)
                return
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            old_owner_id = data[name]['owner_id']
            data[name]['owner_id'] = new_owner.id
            try:
                save_data(data)
            except PermissionError:
                await interaction.response.send_message("Ошибка доступа к characters.json.", ephemeral=True)
                return
            await interaction.response.send_message(f"Владелец персонажа **{name}** изменён с <@{old_owner_id}> на <@{new_owner.id}>.")

        @self.tree.command(name="char_delete", description="Удалить персонажа", guild=guild)
        @app_commands.describe(name="Имя персонажа")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_delete(interaction: discord.Interaction, name: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь удалить чужого персонажа.", ephemeral=True)
                return
            del data[name]
            save_data(data)
            await interaction.response.send_message(f"Персонаж **{name}** удалён.")

        @self.tree.command(name="char_set", description="Изменить раздел персонажа", guild=guild)
        @app_commands.describe(name="Имя", section="Раздел", value="Значение")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_set(interaction: discord.Interaction, name: str, section: str, value: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь менять чужого персонажа.", ephemeral=True)
                return
            if section == "Навыки":
                await interaction.response.send_message("Для изменения навыков используй /char_skill.", ephemeral=True)
                return
            data[name]['fields'][section] = value
            save_data(data)
            await interaction.response.send_message(f"Обновлён раздел **{section}** у **{name}**.")

        @self.tree.command(name="char_skill", description="Изменить характеристику персонажа", guild=guild)
        @app_commands.describe(name="Имя", skill="Навык", value="Новое значение (число)")
        @app_commands.autocomplete(name=name_autocomplete, skill=skill_autocomplete)
        async def char_skill(interaction: discord.Interaction, name: str, skill: str, value: int):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь менять чужого персонажа.", ephemeral=True)
                return
            if "Навыки" not in data[name]['fields']:
                data[name]['fields']["Навыки"] = {skill: DEFAULT_SKILLS[skill] for skill in DEFAULT_SKILLS}
            if skill not in DEFAULT_SKILLS:
                await interaction.response.send_message("Нет такого навыка.", ephemeral=True)
                return
            data[name]['fields']["Навыки"][skill] = value
            save_data(data)
            mod = calc_modifier(value)
            sign = "+" if mod >= 0 else ""
            await interaction.response.send_message(
                f"Навык **{skill}** у **{name}** теперь {value} ({sign}{mod})"
            )

        @self.tree.command(name="char_image", description="Установить картинку персонажа", guild=guild)
        @app_commands.describe(name="Имя персонажа", url="URL картинки")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_image(interaction: discord.Interaction, name: str, url: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь менять чужого персонажа.", ephemeral=True)
                return
            
            # Если это Discord CDN URL, кэшируем его локально
            if url.startswith("https://cdn.discordapp.com"):
                cached_path = cache_discord_avatar(url, name, interaction.user.id)
                if cached_path:
                    data[name]['image_url'] = cached_path
                    save_data(data)
                    await interaction.response.send_message(f"Картинка для **{name}** установлена (кэширована локально).")
                    return
                else:
                    await interaction.response.send_message(f"Ошибка: не удалось загрузить Discord картинку. Попробуй позже.", ephemeral=True)
                    return
            
            # Обычный URL
            data[name]['image_url'] = url
            save_data(data)
            await interaction.response.send_message(f"Картинка для **{name}** установлена.")

        @self.tree.command(name="char_image_delete", description="Удалить картинку персонажа", guild=guild)
        @app_commands.describe(name="Имя персонажа")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_image_delete(interaction: discord.Interaction, name: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь менять чужого персонажа.", ephemeral=True)
                return
            data[name]['image_url'] = ""
            save_data(data)
            await interaction.response.send_message(f"Картинка для **{name}** удалена.")

        @self.tree.command(name="char_section_delete", description="Удалить раздел персонажа", guild=guild)
        @app_commands.describe(name="Имя персонажа", section="Название раздела")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_section_delete(interaction: discord.Interaction, name: str, section: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь менять чужого персонажа.", ephemeral=True)
                return
            if section == "Навыки":
                await interaction.response.send_message("Раздел 'Навыки' нельзя удалить.", ephemeral=True)
                return
            if section not in data[name]['fields']:
                await interaction.response.send_message("Такого раздела нет.", ephemeral=True)
                return
            del data[name]['fields'][section]
            save_data(data)
            await interaction.response.send_message(f"Раздел **{section}** у **{name}** удалён.")

        @self.tree.command(name="char_list", description="Показать список всех персонажей", guild=guild)
        async def char_list(interaction: discord.Interaction):
            data = load_data()
            if not data:
                await interaction.response.send_message("Нет ни одного персонажа.", ephemeral=True)
                return
            msg = "**Список персонажей:**\n"
            for name in data:
                msg += f"- {name}\n"
            await interaction.response.send_message(msg)

        def is_gamemaster(member: discord.Member):
            return any(role.name == "Game Master" for role in member.roles) or has_admin_or_role(member)

        @self.tree.command(name="inventory_add", description="Добавить предмет в инвентарь персонажа", guild=guild)
        @app_commands.autocomplete(name=name_autocomplete)
        @app_commands.describe(
            name="Имя персонажа",
            item="Название предмета",
            description="Описание предмета (необязательно)",
            quantity="Количество (по умолчанию 1)"
        )
        async def inventory_add(interaction: discord.Interaction, name: str, item: str, quantity: int = 1, description: str = ""):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            owner_id = data[name]['owner_id']
            member = await interaction.guild.fetch_member(interaction.user.id)
            if interaction.user.id != owner_id and not is_gamemaster(member):
                await interaction.response.send_message("Ты не можешь менять инвентарь чужого персонажа.", ephemeral=True)
                return
            inv = data[name]['fields'].setdefault("Инвентарь", {})
            if item in inv:
                inv[item]['quantity'] += quantity
            else:
                inv[item] = {'description': description, 'quantity': quantity}
            save_data(data)
            await interaction.response.send_message(f"Добавлено {quantity}x **{item}** в инвентарь {name}.")

        @self.tree.command(name="inventory_remove", description="Удалить предмет из инвентаря персонажа", guild=guild)
        @app_commands.autocomplete(name=name_autocomplete)
        @app_commands.describe(
            name="Имя персонажа",
            item="Название предмета",
            quantity="Количество (по умолчанию 1, 'all' — удалить всё)"
        )
        async def inventory_remove(interaction: discord.Interaction, name: str, item: str, quantity: str = "1"):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            owner_id = data[name]['owner_id']
            member = await interaction.guild.fetch_member(interaction.user.id)
            if interaction.user.id != owner_id and not is_gamemaster(member):
                await interaction.response.send_message("Ты не можешь менять инвентарь чужого персонажа.", ephemeral=True)
                return
            inv = data[name]['fields'].get("Инвентарь", {})
            if item not in inv:
                await interaction.response.send_message("Такого предмета нет в инвентаре.", ephemeral=True)
                return
            if quantity == "all":
                del inv[item]
                save_data(data)
                await interaction.response.send_message(f"Удалены все **{item}** из инвентаря {name}.")
                return
            try:
                qty = int(quantity)
            except ValueError:
                await interaction.response.send_message("Количество должно быть числом или 'all'.", ephemeral=True)
                return
            if qty >= inv[item]['quantity']:
                del inv[item]
                await interaction.response.send_message(f"Удалены все **{item}** из инвентаря {name}.")
            else:
                inv[item]['quantity'] -= qty
                await interaction.response.send_message(f"Удалено {qty}x **{item}** из инвентаря {name}.")
            save_data(data)

        @self.tree.command(name="inventory_give", description="Передать предмет другому персонажу", guild=guild)
        @app_commands.describe(
            from_name="Имя персонажа-отправителя",
            to_name="Имя персонажа-получателя",
            item="Название предмета",
            quantity="Количество (по умолчанию 1, 'all' — всё)"
        )
        async def inventory_give(interaction: discord.Interaction, from_name: str, to_name: str, item: str, quantity: str = "1"):
            data = load_data()
            if from_name not in data or to_name not in data:
                await interaction.response.send_message("Один из персонажей не найден.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if interaction.user.id != data[from_name]['owner_id'] and not is_gamemaster(member):
                await interaction.response.send_message("Ты не владелец персонажа-отправителя.", ephemeral=True)
                return
            from_inv = data[from_name]['fields'].get("Инвентарь", {})
            to_inv = data[to_name]['fields'].setdefault("Инвентарь", {})
            if item not in from_inv:
                await interaction.response.send_message("У отправителя нет такого предмета.", ephemeral=True)
                return
            if quantity == "all":
                qty = from_inv[item]['quantity']
            else:
                try:
                    qty = int(quantity)
                except ValueError:
                    await interaction.response.send_message("Количество должно быть числом или 'all'.", ephemeral=True)
                    return
                if qty > from_inv[item]['quantity']:
                    await interaction.response.send_message("Недостаточно предметов для передачи.", ephemeral=True)
                    return
            if item in to_inv:
                to_inv[item]['quantity'] += qty
            else:
                to_inv[item] = {
                    'description': from_inv[item]['description'],
                    'quantity': qty
                }
            if qty == from_inv[item]['quantity']:
                del from_inv[item]
            else:
                from_inv[item]['quantity'] -= qty
            save_data(data)
            await interaction.response.send_message(f"Передано {qty}x **{item}** от {from_name} к {to_name}.")

        @self.tree.command(name="char_view", description="Посмотреть лист персонажа", guild=guild)
        @app_commands.describe(name="Имя персонажа")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_view(interaction: discord.Interaction, name: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            # Собираем поля для embed
            fields = []
            if data[name].get('show_skills', True):
                skills = data[name]['fields'].get("Навыки", {})
                if skills:
                    skill_lines = []
                    for skill, value in skills.items():
                        mod = calc_modifier(value)
                        sign = "+" if mod >= 0 else ""
                        skill_lines.append(f"{skill} - {value} ({sign}{mod})")
                    skill_text = "\n".join(skill_lines)
                    fields.append({"name": "Навыки", "value": skill_text, "inline": False})
            inv = data[name]['fields'].get("Инвентарь", {})
            if inv:
                inv_lines = []
                for item, info in inv.items():
                    line = f"__{item}__ [x{info['quantity']}]"
                    if info.get("description"):
                        line += f"\n-# {info['description']}"
                    inv_lines.append(line)
                inv_text = "\n".join(inv_lines)
                fields.append({"name": "Инвентарь", "value": inv_text, "inline": False})
            for key, value in data[name]['fields'].items():
                if key in ["Навыки", "Инвентарь"]:
                    continue
                fields.append({"name": key, "value": str(value), "inline": False})

            # Embed лимиты
            EMBED_TOTAL_LIMIT = 6000
            EMBED_FIELD_LIMIT = 1024
            EMBED_MAX_FIELDS = 25

            embeds = []
            current_embed = discord.Embed(title=f"Лист персонажа: {name}", color=0x7289da)
            image_url = data[name].get('image_url', '')
            
            # Подготавливаем файл для локальной аватарки
            avatar_file = None
            if image_url.startswith("avatars/") and os.path.exists(image_url):
                # Локальный файл - отправляем как attachment
                avatar_file = discord.File(image_url, filename="avatar.png")
                current_embed.set_image(url="attachment://avatar.png")
            elif image_url and is_valid_url(image_url):
                # Обычная URL ссылка
                current_embed.set_image(url=image_url)
            
            current_length = len(current_embed.title) + len(current_embed.description or "")
            field_count = 0

            for f in fields:
                value = f["value"]
                # Если поле слишком длинное, разбиваем по строкам и пробелам, не разделяя слова
                if len(value) > EMBED_FIELD_LIMIT:
                    lines = value.split("\n")
                    chunk = ""
                    first_field = True
                    for line in lines:
                        while len(line) > EMBED_FIELD_LIMIT:
                            split_pos = line.rfind(' ', 0, EMBED_FIELD_LIMIT)
                            if split_pos == -1:
                                split_pos = EMBED_FIELD_LIMIT
                            chunk_part = line[:split_pos]
                            line = line[split_pos:].lstrip()
                            if chunk:
                                chunk += "\n" + chunk_part
                            else:
                                chunk = chunk_part
                            # Только первый field с названием, остальные с пустым именем
                            field_name = f["name"] if first_field else ""
                            current_embed.add_field(name=field_name, value=chunk, inline=f["inline"])
                            field_count += 1
                            current_length += len(chunk)
                            chunk = ""
                            first_field = False
                            if current_length > EMBED_TOTAL_LIMIT or field_count >= EMBED_MAX_FIELDS:
                                embeds.append(current_embed)
                                current_embed = discord.Embed(title=f"Лист персонажа: {name}", color=0x7289da)
                                if image_url.startswith("avatars/") and os.path.exists(image_url) and len(embeds) == 1:
                                    current_embed.set_image(url="attachment://avatar.png")
                                elif image_url and is_valid_url(image_url):
                                    current_embed.set_image(url=image_url)
                                current_length = len(current_embed.title)
                                field_count = 0
                        if len(chunk) + len(line) + 1 > EMBED_FIELD_LIMIT:
                            field_name = f["name"] if first_field else ""
                            current_embed.add_field(name=field_name, value=chunk, inline=f["inline"])
                            field_count += 1
                            current_length += len(chunk)
                            chunk = line
                            first_field = False
                            if current_length > EMBED_TOTAL_LIMIT or field_count >= EMBED_MAX_FIELDS:
                                embeds.append(current_embed)
                                current_embed = discord.Embed(title=f"Лист персонажа: {name}", color=0x7289da)
                                if image_url.startswith("avatars/") and os.path.exists(image_url) and len(embeds) == 1:
                                    current_embed.set_image(url="attachment://avatar.png")
                                elif image_url and is_valid_url(image_url):
                                    current_embed.set_image(url=image_url)
                                current_length = len(current_embed.title)
                                field_count = 0
                        else:
                            chunk += ("\n" if chunk else "") + line
                    if chunk:
                        field_name = f["name"] if first_field else ""
                        current_embed.add_field(name=field_name, value=chunk, inline=f["inline"])
                        field_count += 1
                        current_length += len(chunk)
                        if current_length > EMBED_TOTAL_LIMIT or field_count >= EMBED_MAX_FIELDS:
                            embeds.append(current_embed)
                            current_embed = discord.Embed(title=f"Лист персонажа: {name}", color=0x7289da)
                            if image_url.startswith("avatars/") and os.path.exists(image_url) and len(embeds) == 1:
                                current_embed.set_image(url="attachment://avatar.png")
                            elif image_url and is_valid_url(image_url):
                                current_embed.set_image(url=image_url)
                            current_length = len(current_embed.title)
                            field_count = 0
                else:
                    current_embed.add_field(name=f["name"], value=value, inline=f["inline"])
                    field_count += 1
                    current_length += len(value)
                    if current_length > EMBED_TOTAL_LIMIT or field_count >= EMBED_MAX_FIELDS:
                        embeds.append(current_embed)
                        current_embed = discord.Embed(title=f"Лист персонажа: {name}", color=0x7289da)
                        if image_url.startswith("avatars/") and os.path.exists(image_url) and len(embeds) == 1:
                            current_embed.set_image(url="attachment://avatar.png")
                        elif image_url and is_valid_url(image_url):
                            current_embed.set_image(url=image_url)
                        current_length = len(current_embed.title)
                        field_count = 0

            # Добавляем последний embed
            if field_count > 0 or len(embeds) == 0:
                embeds.append(current_embed)

            # Отправляем все embed
            for idx, emb in enumerate(embeds):
                if idx == 0:
                    await interaction.response.send_message(embed=emb, file=avatar_file)
                else:
                    await interaction.followup.send(embed=emb)

        @self.tree.command(name="char_toggle_skills", description="Переключить отображение навыков", guild=guild)
        @app_commands.describe(name="Имя персонажа")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_toggle_skills(interaction: discord.Interaction, name: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь менять чужого персонажа.", ephemeral=True)
                return
            current = data[name].get('show_skills', True)
            data[name]['show_skills'] = not current
            save_data(data)
            status = "включено" if data[name]['show_skills'] else "выключено"
            await interaction.response.send_message(f"Отображение навыков для **{name}** {status}.")

        # ---- Новые команды, связанные с картами и перемещением персонажей ----
        @self.tree.command(name="map_view", description="Показать список карт и открыть выбранную", guild=guild)
        async def map_view(interaction: discord.Interaction):
            maps = get_map_names()
            if not maps:
                await interaction.response.send_message("В каталоге `maps/` не найдено ни одной карты (.png).", ephemeral=True)
                return
            options = [discord.SelectOption(label=m, value=m) for m in maps[:25]]
            view = MapView(self, options)
            await interaction.response.send_message("Выбери карту для просмотра:", view=view, ephemeral=False)

        @self.tree.command(name="char_move_point", description="Переместить персонажа в точку на карте (по id точки)", guild=guild)
        @app_commands.describe(name="Имя персонажа", map="Карта (имя файла без расширения)", point_id="ID точки (как в JSON)")
        @app_commands.autocomplete(name=name_autocomplete, map=map_autocomplete)
        async def char_move_point(interaction: discord.Interaction, name: str, map: str, point_id: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь перемещать чужого персонажа.", ephemeral=True)
                return
            map_json_path = os.path.join(MAPS_DIR, f"{map}.json")
            if not os.path.exists(map_json_path):
                await interaction.response.send_message("Карта не найдена.", ephemeral=True)
                return
            try:
                with open(map_json_path, "r", encoding="utf-8") as f:
                    mdata = json.load(f)
                locs = mdata.get("locations", [])
                found = None
                for loc in locs:
                    if str(loc.get("id")) == str(point_id) or str(loc.get("name")).lower() == str(point_id).lower():
                        found = loc
                        break
                if not found:
                    names = ", ".join([f"{l.get('id')}({l.get('name')})" for l in locs[:50]]) or "—"
                    await interaction.response.send_message(f"Точка с id/name `{point_id}` не найдена.\nДоступные точки: {names}", ephemeral=True)
                    return
                x = float(found.get("x", 0.5))
                y = float(found.get("y", 0.5))
                data[name].setdefault("location", {})
                data[name]['location'] = {"map": map, "x": x, "y": y, "point_id": found.get("id")}
                save_data(data)
                await interaction.response.send_message(f"Персонаж **{name}** перемещён на карту **{map}** → точка **{found.get('name')} (id={found.get('id')})**.")
            except Exception as e:
                await interaction.response.send_message(f"Ошибка: {e}", ephemeral=True)

        @self.tree.command(name="char_move_coords", description="Переместить персонажа на карту в координаты (0..1)", guild=guild)
        @app_commands.describe(name="Имя персонажа", map="Карта (имя файла без расширения)", x="Координата X (0.0 - 1.0)", y="Координата Y (0.0 - 1.0)")
        @app_commands.autocomplete(name=name_autocomplete, map=map_autocomplete)
        async def char_move_coords(interaction: discord.Interaction, name: str, map: str, x: float, y: float):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь перемещать чужого персонажа.", ephemeral=True)
                return
            if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                await interaction.response.send_message("Координаты должны быть в диапазоне 0.0 — 1.0.", ephemeral=True)
                return
            data[name].setdefault("location", {})
            data[name]['location'] = {"map": map, "x": float(x), "y": float(y), "point_id": None}
            save_data(data)
            await interaction.response.send_message(f"Персонаж **{name}** перемещён на карту **{map}** → ({x:.3f}, {y:.3f}).")

        @self.tree.command(name="char_remove_from_map", description="Удалить персонажа с карты (снять позицию)", guild=guild)
        @app_commands.describe(name="Имя персонажа")
        @app_commands.autocomplete(name=name_autocomplete)
        async def char_remove_from_map(interaction: discord.Interaction, name: str):
            data = load_data()
            if name not in data:
                await interaction.response.send_message("Такого персонажа нет.", ephemeral=True)
                return
            member = await interaction.guild.fetch_member(interaction.user.id)
            if data[name]['owner_id'] != interaction.user.id and not has_admin_or_role(member):
                await interaction.response.send_message("Ты не можешь убирать чужого персонажа с карты.", ephemeral=True)
                return
            if 'location' in data[name]:
                del data[name]['location']
                save_data(data)
                await interaction.response.send_message(f"Позиция персонажа **{name}** удалена (он больше не на карте).")
            else:
                await interaction.response.send_message(f"У персонажа **{name}** не было позиции на карте.", ephemeral=True)

        # Повторная синхронизация
        await self.tree.sync(guild=guild)
        print("✅ Команды очищены и перерегистрированы!")

bot = AraBot()

@bot.event
async def on_ready():
    print(f"✅ Бот запущен как {bot.user}")

# Запуск бота с токеном из .env
bot.run(os.getenv("DISCORD_TOKEN"))
