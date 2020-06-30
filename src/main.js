"use strict"
const mineflayer = require('mineflayer');
const navigatePlugin = require('mineflayer-navigate')(mineflayer);
const AutoAuth = require('mineflayer-auto-auth');
const vec3 = require('vec3');
const tpsPlugin = require('mineflayer-tps')(mineflayer);
const fs = require('fs');
const repl = require('repl')
require('console-png').attachTo(console);
const term = require('terminal-kit').terminal;
const blockFinderPlugin = require('mineflayer-blockfinder')(mineflayer);

let connection_interval = null
let chest_selling = false

const accounts = require("../accounts.json")
const directions = {
    UP: vec3(0, 1, 0),
    DOWN: vec3(0, -1, 0),
    POSITIVE_X: vec3(1, 0, 0),
    NEGATIVE_X: vec3(-1, 0, 0),
    POSITIVE_Z: vec3(0, 0, 1),
    NEGATIVE_Z: vec3(0, 0, -1)
}

term.green("Выберите аккаунт:\n")
term.singleColumnMenu(accounts.map((r, i) => `${i}. ${r.username}`), {exitOnUnexpectedKey: true}, (error, response) => {
    if (response.selectedIndex === undefined) {
        term.red("\nПрограмма завершена\n")
        process.exit(0)
    }
    let c = response.selectedIndex
    term.green(`Вы выбрали: ${accounts[c].username}\n`)
    let options = {
        host: "play.divinecraft.ru",
        port: 25565,
        username: accounts[c].username,
        version: "1.12",
        plugins: [AutoAuth],
        AutoAuth: {
            logging: true,
            password: accounts[c].password,
            ignoreRepeat: true
        },
        checkTimeoutInterval: 60 * 5 * 1000
    }

    function sleepPromise(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }

    let blocksDig = []

    const bot = mineflayer.createBot(options);
    let configFile = `${bot.username}-config.json`

    const r = repl.start(" > ")
    bind_bot(bot)
    r.context.mineflayer = mineflayer
    r.context.v = vec3;

    function bind_bot(bot) {
        bot.clickWindowPromise = (slot, button, mode) => {
            return new Promise((resolve, reject) => {
                bot.clickWindow(slot, button, mode, err => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        }

        bot.tossStackPromise = (item) => {
            return new Promise((resolve, reject) => {
                bot.tossStack(item, err => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        }

        bot.fishPromise = () => {
            return new Promise((resolve, reject) => {
                bot.fish(err => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        }

        bot.equipPromise = (item, destination) => {
            return new Promise((resolve, reject) => {
                bot.equip(item, destination, err => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        }

        bot.closeWindowPromise = (window) => {
            return new Promise(resolve => {
                let tmp_func = (window1) => {
                    if (window.id === window1.id) {
                        bot.removeListener("windowClose", tmp_func)
                        resolve()
                    }
                }
                bot.on("windowClose", tmp_func)
                bot.closeWindow(window)
            })
        }

        bot.openChestPromise = (chestBlock) => {
            return new Promise((resolve) => {
                let chest = bot.openChest(chestBlock)
                chest.on("open", () => {
                    chest.closePromise = () => {
                        return new Promise(resolve1 => {
                            chest.on("close", () => {
                                resolve1()
                            })
                            chest.close()
                        })
                    }

                    chest.depositPromise = (itemType, metadata, count) => {
                        return new Promise(resolve1 => {
                            chest.deposit(itemType, metadata, count, () => {
                                resolve1()
                            })
                        })
                    }

                    chest.withdrawPromise = (itemType, metadata, count) => {
                        return new Promise(resolve1 => {
                            chest.withdraw(itemType, metadata, count, () => {
                                resolve1()
                            })
                        })
                    }

                    resolve(chest)
                })
            })
        }

        bot.waitWindowPromise = (condition, initial = () => {
        }) => {
            return new Promise(resolve => {
                let interval = setInterval(initial, 1000)
                let tmp_func = (window) => {
                    if (condition(window)) {
                        clearInterval(interval)
                        bot.removeListener("windowOpen", tmp_func)
                        resolve(window)
                    }
                }
                bot.on("windowOpen", tmp_func)
                initial()
            })
        }

        bot.placeBlockPromise = (referenceBlock, faceVector) => {
            return new Promise(resolve => {
                bot.placeBlock(referenceBlock, faceVector, () => {
                    resolve()
                })
            })
        }

        bot.activateBlockPromise = (block) => {
            return new Promise((resolve, reject) => {
                bot.activateBlock(block, err => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        }

        bot.lookPromise = (yaw, pitch) => {
            return new Promise((resolve, reject) => {
                bot.look(yaw, pitch, null, () => {
                    resolve()
                })
            })
        }

        bot.digPromise = (block) => {
            return new Promise((resolve, reject) => {
                bot.dig(block, err => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        }

        const whisper_commands = [
            {
                command: "подойди",
                func(username) {
                    const target = bot.players[username].entity;
                    bot.navigate.to(target.position)
                }
            },
            {
                command: "посмотри",
                func(username) {
                    const {yaw, pitch} = bot.players[username].entity;
                    bot.look(yaw, pitch)
                }
            },
            {
                command: "рыбалка",
                func() {
                    startFish()
                }
            },
            {
                command: "копать",
                func() {
                    refreshDig = true
                    digGenerator()
                }
            },
            {
                command: "качать",
                func() {
                    sellBlocks()
                }
            },
            {
                command: "дроп",
                func() {
                    dropAll()
                }
            }
        ]
        let mcData = require('minecraft-data')(bot.version)

        function clickCompas() {
            if (bot.inventory.slots[36]?.name === 'compass') {
                try {
                    bot.setQuickBarSlot(0)
                } catch (e) {
                    console.error(e)
                }
                bot.activateItem()
            }
        }

        function switchConnection() {
            if (connection_interval) {
                clearInterval(connection_interval)
                connection_interval = null
            } else {
                connection_interval = setInterval(clickCompas, 500)
            }
        }

        switchConnection()

        bot.on("scoreboardTitleChanged", (scoreboard) => {
            console.log(scoreboard)
        })

        setInterval(() => {
            if (bot.scoreboard[1]?.title.indexOf("DivineCraft") > -1 && !connection_interval) {
                switchConnection()
            }
        }, 1000)

        let refreshDig = true

        async function digGenerator() {
            let errors = 0
            let interval = setInterval(() => {
                errors = 0
            }, 1000)
            // Копалка разрешена
            while (refreshDig) {
                if (errors >= 10) {
                    clearInterval(interval)
                    break
                }
                let posBlock = blocksDig.shift()
                blocksDig.push(posBlock)
                let block = bot.blockAt(vec3(posBlock))
                if (block) {
                    try {
                        await bot.digPromise(block)
                    } catch (e) {
                        console.error(e)
                        await sleepPromise(50)
                        errors++;
                    }
                } else {
                    await sleepPromise(50)
                }
            }
        }

        function getCoordinatesTrampledDirt(x1,y1,z1, x2,y2,z2) {
            let str = ""
            for (let j = y1; j <= y2; j++) {
                for (let i = x1; i <= x2; i++) {
                    for (let k = z1; k <= z2; k++) {
                        let pos = vec3(i, j, k)
                        let block = bot.blockAt(pos)
                        if (block && block.type === 3 && Math.abs(k) % 2 === 1) {
                            str += pos + "\n"
                        }
                    }

                }
            }
            fs.writeFile("blocks.txt", str, () => {
                console.log("Запись завершена")
            })
        }

        async function startFish() {
            // new code
            while (bot.inventory.count(mcData.itemsByName.fishing_rod.id) > 0) {
                while (bot.heldItem.type !== mcData.itemsByName.fishing_rod.id) {
                    try {
                        await bot.equipPromise(mcData.itemsByName.fishing_rod.id, "hand")
                    } catch (e) {
                        console.error(e)
                    }
                }
                try {
                    await bot.fishPromise()
                    await setTimeout(() => {
                    }, 50)
                } catch (e) {
                    console.error(e)
                }
            }
        }

        function sellBlocks() {
            if (bot.currentWindow?.title.indexOf("Уровень острова") > -1) {
                function sell(slot) {
                    return bot.clickWindowPromise(slot, 0, 0).then(() => {
                        bot.clickWindowPromise(22, 0, 0)
                    })
                }

                var p = Promise.resolve();
                bot.currentWindow?.slots.forEach(r => {
                    if ([133, 57, 42, 41, 152, 22, 173, 155].includes(r?.type)) {
                        p = p.then(() => sell(r.slot));
                    }
                })
                p.then(() => bot.closeWindow(bot?.currentWindow))
            } else {
                bot.chat('/is level')
            }
        }

        async function clearChestSellMelonsPutChest(chestBlockClear, chestBlockPut) {
            chest_selling = true
            let chestClear
            let chestPut
            let p
            let free_slots
            let window

            // Цикл пока chest_selling
            while (chest_selling) {
                // Счистка арбузов
                free_slots = bot.inventory.slots.filter((r, i) => r === null && 9 <= i && i < 45).length
                chestClear = await bot.openChestPromise(chestBlockClear);
                await chestClear.withdrawPromise(103, null, free_slots * 64)
                await chestClear.closePromise()

                // Продажа
                window = await bot.waitWindowPromise((window) => {
                    if (window.title.indexOf("Магазин обменник") > -1) {
                        return true
                    } else {
                        return false
                    }
                }, () => bot.chat("/shop exchanger2"))

                //console.log(bot.inventory.count(103))
                await bot.clickWindowPromise(15, 2, 3)
                await bot.closeWindowPromise(window)

                // Складывание результатау
                chestPut = await bot.openChestPromise(chestBlockPut);
                await chestPut.depositPromise(388, null, 36 * 64)
                await chestPut.closePromise()
                await sleepPromise(1000)
            }
        }

        function dropAll() {
            var p = Promise.resolve();
            bot.inventory.slots.forEach(r => {
                if (r) {
                    p = p.then(() => bot.tossStackPromise(r));
                }
            })
        }

        function switchDig() {
            refreshDig = !refreshDig
        }

        function setTarget(target) {
            if (whisper_commands.filter(r => r.command === target) > 0) {
                fs.readFile(configFile, (err, data) => {
                    let obj = JSON.parse(data.toString()) || {}
                    obj.target = target
                    fs.writeFile(configFile, JSON.stringify(obj), (err1 => {
                        if (err1) console.error(err1)
                    }))
                })
            }
        }

        async function teleportToPosition(pos) {
            let bot_pos = bot.entity.position
            let step = 1
            while (!bot_pos.floored().equals(pos.floored())) {
                let dx, dy, dz, s
                dx = pos.x - bot_pos.x
                dy = pos.y - bot_pos.y
                dz = pos.z - bot_pos.z
                s = Math.abs(dx) + Math.abs(dy) + Math.abs(dz)
                bot_pos.add(vec3(dx / s, dy / s, dz / s))
                await sleepPromise(50)
            }
            console.log("Прибыл")
        }

        function getBlockForButton(block) {
            let pos = block.position
            let direction, left, right
            switch (block.metadata) {
                case 2:
                    direction = directions.NEGATIVE_Z
                    left = directions.NEGATIVE_X
                    right = directions.POSITIVE_X
                    break
                case 3:
                    direction = directions.POSITIVE_Z
                    left = directions.POSITIVE_X
                    right = directions.NEGATIVE_X
                    break
                case 4:
                    direction = directions.NEGATIVE_X
                    left = directions.POSITIVE_Z
                    right = directions.NEGATIVE_Z
                    break
                case 5:
                    direction = directions.POSITIVE_X
                    left = directions.NEGATIVE_Z
                    right = directions.POSITIVE_Z
                    break
            }
            if (bot.blockAt(pos.plus(left)).type === 165 || bot.blockAt(pos.plus(direction)).type === 165 || bot.blockAt(pos.plus(right)).type === 165) {
                return block
            } else {
                let new_pos = pos.plus(direction).plus(direction)
                let leftblock = bot.blockAt(new_pos.plus(left))
                let rightblock = bot.blockAt(new_pos.plus(right))
                if (leftblock?.type === 29) {
                    return leftblock
                } else if (rightblock?.type === 29) {
                    return rightblock
                } else {
                    return block
                }
            }
        }

        function sellMelons() {
            if (bot.currentWindow?.title.indexOf("Магазин обменник") > -1) {
                bot.clickWindow(15, 2, 3, () => {
                    bot.clickWindow(15, 2, 3, () => {
                        bot.clickWindow(15, 2, 3, () => {
                            bot.clickWindow(15, 2, 3, () => {
                                bot.clickWindow(15, 2, 3, () => {
                                    bot.clickWindow(15, 2, 3, () => {
                                        bot.closeWindow(bot.currentWindow)
                                    })
                                })
                            })
                        })
                    })
                })
            } else {
                bot.chat("/shop exchanger2")
            }
        }

        function switchSelling() {
            chest_selling = !chest_selling
        }

        async function goToPathPromise(pos) {
            return new Promise(resolve => {
                let tmp_func = () => {
                    bot.navigate.removeListener("arrived", tmp_func)
                    resolve()
                }
                bot.navigate.on('arrived', tmp_func);
                bot.navigate.to(pos)
            })
        }

        async function restoreCombines(x0, x, y0, y, z, yOffset, homePosition) {
            while (!(bot.entity.position.y - 1 < homePosition.y && homePosition.y < bot.entity.position.y + yOffset)) {
                if (bot.entity.position.y > homePosition.y) {
                    bot.entity.position.add(vec3(0, -yOffset, 0))
                } else {
                    bot.entity.position.add(vec3(0, yOffset, 0))
                }
                await sleepPromise(500)
            }
            await goToPathPromise(homePosition)
            let blockPos = []
            for (let j = y0; j <= y; j += yOffset) {
                console.log(j)
                for (let k = x0; k <= x; k++) {
                    let block = bot.blockAt(vec3(k, j, z))
                    if (block?.type === 29) {
                        blockPos.push(block.position.floored())
                        break
                    }
                }
            }
            await sleepPromise(2000)
            for (let i = 0; i < blockPos.length; i++) {
                console.log(i)
                try {
                    let block = bot.blockAt(blockPos[i])
                    if (block?.type === 29) {
                        let blockForButton = getBlockForButton(block)
                        while (!(bot.entity.position.y < blockForButton.position.y && blockForButton.position.y < bot.entity.position.y + yOffset)) {
                            console.log(bot.entity.position, blockForButton.position)
                            if (bot.entity.position.y > blockForButton.position.y) {
                                bot.entity.position.add(vec3(0, -yOffset, 0))
                            } else {
                                bot.entity.position.add(vec3(0, yOffset, 0))
                            }
                            await sleepPromise(500)
                        }
                        await goToPathPromise(homePosition.floored().set(blockForButton.position.x, bot.entity.position.y, bot.entity.position.z))
                        await bot.placeBlockPromise(blockForButton, directions.UP)
                        await bot.activateBlockPromise(bot.blockAt(blockForButton.position.plus(directions.UP)))
                        await goToPathPromise(homePosition.floored().set(homePosition.x, bot.entity.position.y, bot.entity.position.z))
                    }
                } catch (e) {
                    console.error(e)
                }
            }
            while (!(bot.entity.position.y - 1 < homePosition.y && homePosition.y < bot.entity.position.y + yOffset)) {
                if (bot.entity.position.y > homePosition.y) {
                    bot.entity.position.add(vec3(0, -yOffset, 0))
                } else {2
                    bot.entity.position.add(vec3(0, yOffset, 0))
                }
                await sleepPromise(500)
            }
        }

        r.context.restoreCombines = restoreCombines
        r.context.teleportToPosition = teleportToPosition
        r.context.getBlockForButton = getBlockForButton
        r.context.switchSelling = switchSelling
        r.context.clearChestSellMelonsPutChest = clearChestSellMelonsPutChest
        r.context.sellMelons = sellMelons
        r.context.mcData = mcData
        r.context.sellBlocks = sellBlocks
        r.context.setTarget = setTarget
        r.context.whisper_commands = whisper_commands
        r.context.switchDig = switchDig
        r.context.bot = bot
        bot.loadPlugin(tpsPlugin)
        bot.loadPlugin(blockFinderPlugin);
        navigatePlugin(bot)
        bot.navigate.blocksToAvoid[132] = true; // avoid tripwire
        bot.navigate.blocksToAvoid[59] = false; // ok to trample crops
        function onWindowUpdate() {
        }

        function onWindowOpen(window) {
            if (window.title.indexOf("Выбор режима") > -1) {
                let item = window.slots.filter(r => {
                    if (r) {
                        return ["§bSkyBlock", "§bSkyBlock §e§lСделали вайп!"].includes(r.nbt?.value.display.value.Name.value)
                    } else {
                        return false
                    }
                })[0]
                if (item) {
                    bot.clickWindow(item.slot, 0, 0)
                }
            } else if (window.title.indexOf("Уровень острова") > -1) {
                sellBlocks()
            }
        }

        bot.inventory.on("windowUpdate", onWindowUpdate)
        bot.on("windowOpen", onWindowOpen)
        bot.on('message', (messageObject) => {
                let messageJson = messageObject.json
                if (messageJson.extra !== undefined) {
                    let text_splited = messageJson.extra.map(obj => obj.text)
                    if ((messageJson.extra.length === 7 || messageJson.extra.length === 8) && text_splited[0] === "ЛС ") {
                        let [username, message] = [text_splited[messageJson.extra.length === 7 ? 2 : 3].slice(0, -1), text_splited[messageJson.extra.length === 7 ? 6 : 7].toLowerCase()]
                        // console.log(`-> ${username}: ${message}`)
                        whisper_commands.forEach(obj => {
                            if (message.indexOf(obj.command) > -1) {
                                obj.func(username, message)
                            }
                        })
                    } else if (messageJson.extra.length === 4) {
                        if (text_splited[3].startsWith("skyblock") && text_splited[3] !== 'skyblock') {
                            bot.chat("/lobby")
                        } else if (text_splited[3] === 'skyblock') {
                            term.green("Бот начал работать\n")
                            if (connection_interval) {
                                switchConnection()
                            }
                            fs.readFile(configFile, (err, data) => {
                                if (err) console.log(err)
                                else {
                                    let p = Promise.resolve()
                                    const {slot, yaw, pitch, clearChestBlock, putChestBlock, target, blocksToDig} = JSON.parse(data) || {}
                                    if (yaw && pitch) {
                                        p = p.then(() => bot.lookPromise(yaw, pitch))
                                    }
                                    if (slot) {
                                        bot.setQuickBarSlot(slot)
                                    }
                                    if (blocksToDig) {
                                        blocksDig = blocksToDig
                                    }
                                    if (clearChestBlock && putChestBlock && target === "продажа") {
                                        p = p.then(() => clearChestSellMelonsPutChest(bot.blockAt(vec3(clearChestBlock)), bot.blockAt(vec3(putChestBlock))))
                                    } else if (target) {
                                        let whisper_command = whisper_commands.filter(r => r.command === target)[0]
                                        if (whisper_command) {
                                            p = p.then(whisper_command.func)
                                        }
                                    }
                                }
                            })
                        } else if (text_splited[3].startsWith("hub")) {
                            refreshDig = false
                            bot.stopDigging()
                            if (!connection_interval) {
                                switchConnection()
                            }
                        } else if (text_splited[3].startsWith("limbo")) {
                            refreshDig = false
                            bot.stopDigging()
                            bot.setQuickBarSlot(4)
                            bot.activateItem()
                            bot.setQuickBarSlot(0)
                        }
                    }
                    messageJson.extra.forEach(msg => {
                        let t = term
                        let {text, color, bold, italic, ...other} = msg;
                        if (color) {
                            t = t.colorRgbHex({
                                black: '#000',
                                dark_blue: '#0000aa',
                                dark_green: '#00aa00',
                                dark_aqua: '#00aaaa',
                                dark_red: '#aa0000',
                                dark_purple: '#aa00aa',
                                gold: '#ffaa00',
                                gray: '#aaa',
                                dark_gray: '#555',
                                blue: '#5555ff',
                                green: '#55ff55',
                                aqua: '#55ffff',
                                red: '#ff5555',
                                light_purple: '#ff55ff',
                                yellow: '#ffff55',
                                white: '#fff'
                            }[color])
                        }
                        try {
                            if (bold) {
                                t = t.bold
                            }
                            if (italic) {
                                t = t.italic
                            }
                            t(text)
                        } catch {
                            console.log(msg)
                            console.log(t)
                        }
                        if (Object.entries(other).length > 0) {
                            console.log(other)
                        }
                    })
                    term("\n")
                }

            }
        )
        bot.on('error', () => bot.end())

        bot.on("kicked", reason => console.error(reason))


        bot.on("end", () => {
            if (connection_interval) {
                switchConnection()
            }
            refreshDig = false
            bot.removeAllListeners()
            bot = mineflayer.createBot(options);
            bind_bot(bot)
        })

        bot._client.on("map", packet => {
            require('./map.js')(packet.data).writeImage('./map.png', () => {
                console.png('./map.png')
            })
            console.log("Введите капчу:")
        })
    }
})