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

const accounts = require("../accounts.json")
/*
let c = 0
if (process.argv.length >= 3) {
    try {
        c = parseInt(process.argv[2])
    } catch (e) {
        throw e
    }
}*/

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

    const bot = mineflayer.createBot(options);

    const r = repl.start(" > ")
    bind_bot(bot)
    r.context.mineflayer = mineflayer
    r.context.v = vec3;

    function bind_bot(bot) {
        const whisper_commands = [
            {
                command: "подойди",
                func(username) {
                    const target = bot.players[username].entity;
                    way_data.setData(username, target.position, target.pitch, target.yaw)
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
        let configFile = `${bot.username}-config.json`
        let way_data = {
            username: null,
            path: null,
            yaw: null,
            pitch: null,
            clear() {
                this.username = null
                this.path = null
                this.pitch = null
                this.yaw = null
            },
            setData(username, path, pitch, yaw) {
                this.username = username
                this.path = path
                this.pitch = pitch
                this.yaw = yaw
            }
        }
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
                connection_interval = setInterval(clickCompas, 250)
            }
        }

        switchConnection()

        setInterval(() => {
            if (bot.scoreboard[1]?.title.indexOf("DivineCraft") > -1 && !connection_interval) {
                switchConnection()
            }
        }, 1000)

        let refreshDig = false

        function digGenerator() {
            if (bot.scoreboard?.["1"]?.title.indexOf("SkyBlock") === -1) {
                refreshDig = false
            }
            if (!refreshDig) {
                return
            }
            try {
                let block = bot.blockInSight(0, 0)
                bot.dig(block, err => {
                    if (err) console.error(err)
                    else {
                        digGenerator()
                    }
                })
            } catch (e) {
                console.error(e)
                setTimeout(digGenerator, 2000)
            }
        }

        function startFish() {
            bot.equip(mcData.itemsByName.fishing_rod.id, 'hand', err => {
                if (err) {
                    console.error(err)
                } else {
                    const fish = () => {
                        bot.fish(err => {
                            if (err) {
                                console.error(err)
                            }
                            setTimeout(fish, 100)
                        })
                    }
                    fish()
                }
            })
        }

        function sellBlocks() {
            if (bot.currentWindow?.title.indexOf("Уровень острова") > -1) {
                function sell(slot) {
                    return resolve => {
                        bot.clickWindow(slot, 0, 0, () => {
                            bot.clickWindow(22, 0, 0, () => {
                                resolve()
                            })
                        })
                    }
                }

                var p = Promise.resolve();
                bot.currentWindow?.slots.forEach(r => {
                    if ([133, 57, 42, 41, 152, 22, 173, 155].includes(r?.type)) {
                        p = p.then(() => new Promise(sell(r.slot)));
                    }
                })
                p.then(() => bot.closeWindow(bot?.currentWindow))
            } else {
                bot.chat('/is level')
            }
        }

        function dropAll() {
            function drop(item) {
                return (resolve, reject) => {
                    bot.tossStack(item, err => {
                        if (err) {
                            reject(err)
                        }
                        resolve();
                    })
                }
            }

            var p = Promise.resolve();
            bot.inventory.slots.forEach(r => {
                if (r) {
                    p = p.then(() => new Promise(drop(r)), () => new Promise(drop(r)));
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

        function findDirtInPositions() {
            let p = Promise.resolve();

            function blockSeed(block) {
                return (resolve) => {
                    bot.equip(mcData.items[293], "hand", () => {
                        bot.activateBlock(block, () => {
                            bot.equip(mcData.items[362], "hand", () => {
                                bot.activateBlock(block, () => {
                                    resolve()
                                })
                            })
                        })
                    })
                }
            }

        }

        r.context.findDirtInPositions = findDirtInPositions
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
                    bot.clickWindow(item.slot, 0, 0, () => {
                    })
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
                                    const {yaw, pitch, target, slot} = JSON.parse(data) || {}
                                    bot.look(yaw, pitch)
                                    if (slot) {
                                        bot.setQuickBarSlot(slot)
                                    }
                                    let whisper_command = whisper_commands.filter(r => r.command === target)[0]
                                    if (whisper_command) {
                                        setTimeout(whisper_command.func, 5000)
                                    }
                                }
                            })
                        } else if (text_splited[3].startsWith("hub")) {
                            if (!connection_interval) {
                                switchConnection()
                            }
                        } else if (text_splited[3].startsWith("limbo")) {
                            bot.setQuickBarSlot(4)
                            bot.activateItem()
                            bot.setQuickBarSlot(0)
                        }
                    }
                    messageJson.extra.forEach(msg => {
                        let t = term
                        let {text, color, bold, ...other} = msg;
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

        function onScoreboardUpdate(scoreBoard) {
        }

        bot.on("end", () => {
            if (connection_interval) {
                switchConnection()
            }
            bot = mineflayer.createBot(options);
            bind_bot(bot)
        })

        bot.on("scoreboardCreated", onScoreboardUpdate)

        bot._client.on("map", packet => {
            require('./map.js')(packet.data).writeImage('./map.png', () => {
                console.png('./map.png')
            })
            console.log("Введите капчу:")
        })

        bot.navigate.on('pathFound', function (path) {
            //bot.chat(`/msg ${way_data.username} Путь найден. Добираться до него ${path.length} шагов.`);
        });

        bot.navigate.on('cannotFind', function (closestPath) {
            //bot.chat(`/msg ${way_data.username} Я не нашёл путь до него...`);
            bot.navigate.walk(closestPath);
            bot.look(way_data.yaw, way_data.pitch)
            way_data.clear()
        });

        bot.navigate.on('arrived', function () {
            //bot.chat(`/msg ${way_data.username} Я добрался до точки назначения`);
            bot.look(way_data.yaw, way_data.pitch)
            way_data.clear()
        });
    }
})