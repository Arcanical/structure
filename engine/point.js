'use strict'

const POINT_TYPES = [
	"none",
	"power",
	"spirit",
	"blood",
	"fire",
	"ice",
	"metal"
]

const POINT_COLORS = [
	"#EEEEEE",
	"#FFFF55",
	"#ADFF2F",
	"#DC143C",
	"#FF8C00",
	"#00FFFF",
	"#BBBBBB",
]

const POINT_MAX_LEVEL = 4

const SPECIAL_BLOCK = 1
const SPECIAL_COLONY = 2
const SPECIAL_CLONE = 3
const SPECIAL_RESIST = 4
const SPECIAL_NOBUILD = 5
const SPECIAL_NOCLONE = 6

const pointHandler = {
	_init() {
		this.temp = {}
	},
	
	restoreState() {
		this.x = (this.distance * Math.cos(this.angle)).toDigits(3)
		this.y = (this.distance * Math.sin(this.angle)).toDigits(3)
		this.owned = this.owned || false
		this.children = new Set()
		this.parents = new Set()
		this.attackers = new Set()
		this.costs = this.costs || {}
		this.manaCosts = this.manaCosts || {}
		this.displays = this.displays || {}
		this.buildings = this.buildings || {}
		this.production = this.production || {}
	},
	
	calculateStats() {
//		if (!this.initialized || this.initialized < 5) {
			if (this.key) {
				this.keyData = this.map.keys[this.key]
				this.keyData.keyPoint = this
			}
			if (this.lock) {
				this.keyData = this.map.keys[this.lock]
				this.keyData.lockPoint = this
			}
			if (this.parent) {
				this.parent.children.add(this)
				this.dx = this.parent.x - this.x
				this.dy = this.parent.y - this.y
				this.length = Math.hypot(this.dy, this.dx)
				this.pathLength = this.length - this.size - this.parent.size
			}
			this.sdx = this.edx = this.x + this.dx * (this.size + 0.45) / this.length
			this.sdy = this.edy = this.y + this.dy * (this.size + 0.45) / this.length
			if (this.parent) {
				this.sdx = this.parent.x - this.dx * (this.parent.size + 0.45) / this.length
				this.sdy = this.parent.y - this.dy * (this.parent.size + 0.45) / this.length
			}
			let depth = 0
			let pt = this
			while (pt.parent && pt.parent != pt) {
				depth++
				pt = pt.parent
				this.parents.add(pt)
			}
			this.depth = depth
			let locks = 0
			pt = this
			while (pt.parent && pt.parent != pt) {
				if (pt.lock) locks++
				pt = pt.parent
			}				
			this.power = this.customPower || (this.map.basePower * (4 ** (this.distance / this.map.size)) * ((1.1 + 0.005 * this.map.level) ** this.depth) * (1.2 ** locks) * (this.size / 6) * (this.boss?10 ** this.boss:1))
			this.totalPower = this.power * this.length * 0.5
			this.initialized = (this.initialized || 0) + 1
//		}
		this.bonus = Math.sqrt(this.power) * 0.1 * (4 ** (this.level || 0))
		
		this.outs = [...this.children].filter(x => !x.owned && (!x.boss || x.boss <= this.map.boss)).length
		
		if (this.parent)
			this.available = this.parent.owned

		this.costs.levelUp = this.bonus * 2 ** (this.level || 0)
		this.nobuild = [...this.children].filter(x => x.special == SPECIAL_NOBUILD).length > 0
		Object.values(BUILDINGS).map(x => this.costs[x.id] = this.nobuild?-1:x.cost(this))

		this.noclone = this.special == SPECIAL_NOCLONE
		Object.values(SPELLS).map(x => this.manaCosts[x.id] = game.skills.spellcasting && game.skills["book_"+x.book] && (!this.noclone || x.book.substr(0,6) != "summon")? x.cost(this) : -1)

		this.renderSize = this.level?this.size + 0.25 + 2 * this.level:this.size
		if (game && game.skills.magicGrowthBoost && this.map.ownedRadius)
			this.bonusMult = (game.skills.magicGrowthBoost && this.type > 2)?Math.max(0, this.map.ownedRadius - this.distance):0
		
		this.production.mana = this.buildings.manalith?BUILDINGS.manalith.production(this):0
		this.production.gold = this.buildings.goldFactory?BUILDINGS.goldFactory.production(this):0

//		this.bonusMult = (game.skills.magicGrowthBoost && this.type > 2)?Math.max(0, this.map.ownedRadius - this.distance):0
		this.totalBonus = this.bonus * ((this.bonusMult || 0) + 1)
		
		if (!game.offline)
			this.updateDisplay("management", true)
	},
	
	levelUp() {
		if (game.resources.gold < this.costs.levelUp) return
		if (this.level && this.level >= POINT_MAX_LEVEL) return
		
		game.resources.gold -= this.costs.levelUp
		
		this.suspend()
		
		this.level = (this.level || 0) + 1
		
		game.addStatistic("point_level"+this.level)
		
		this.calculateStats()
				
		this.unsuspend()
		
		if (game.autoUpgrading)
			game.autoUpgrading |= 2
		else {
			game.update()
			gui.target.updateUpgrades()
		}
	},
	
	getDisplay(name) {
		if (this.displays[name]) 
			return this.displays[name]
		
		if (name == "management") {
			let display = ManagementPointElement ({
				point : this,
				parent : gui.management.dvList
			})
			this.displays["management"] = display
			return display
		}

		if (name == "lowLoad") {
			let display = PointInfoDisplay ({
				point : this,
				parent : gui.map.dvLowLoad,
				className : "point-info"
			})
			display.dvDisplay.onclick = (event) => (this.locked || gui.target.point == this)?gui.target.reset():gui.target.set(this, event.x, event.y)
			this.displays["lowLoad"] = display
			return display
		}
	},
	
	updateDisplay(name, forced) {
		if (this.displays[name])
			this.displays[name].update(forced)		
	},
	
	build (name) {
		if (!BUILDINGS[name]) return
		if (this.buildings[name]) return
		if (!this.costs[name] || this.costs[name] > game.resources.gold || this.costs[name] < 0) return
		game.resources.gold -= this.costs[name]
		BUILDINGS[name].build(this)
		game.addStatistic("built_"+name)
		this.buildings[name] = 1
		if (game.autoUpgrading)
			game.autoUpgrading |= 4
		else {
			game.update()
			gui.target.updateUpgrades()
			gui.management.update()
		}
	},
	
	cast (name) {
		if (!SPELLS[name]) return
		if (SPELLS[name].type != SPELL_TYPE_POINT) return
		if (this.manaCosts[name] < 0 || this.manaCosts[name] > game.resources.mana) return
		game.resources.mana -= this.manaCosts[name]
		if (SPELLS[name].recalc) this.suspend()
		SPELLS[name].cast(this)
		if (SPELLS[name].recalc) this.unsuspend()
		game.update()
		gui.target.updateUpgrades()		
		game.addStatistic("cast_"+name)
	},
	
	suspend() {
//		this.bonusMult = (game.skills.magicGrowthBoost && this.type > 2)?Math.max(0, this.map.ownedRadius - this.distance):0
		if (this.type && this.owned)
			game.growth[POINT_TYPES[this.type]] -= this.totalBonus
		Object.keys(this.buildings).filter(x => this.buildings[x]).map(x => BUILDINGS[x].destroy(this))
	},
	
	unsuspend() {
		this.bonusMult = (game.skills.magicGrowthBoost && this.type > 2)?Math.max(0, this.map.ownedRadius - this.distance):0
		this.totalBonus = this.bonus * ((this.bonusMult || 0) + 1)
		Object.keys(this.buildings).filter(x => this.buildings[x]).map(x => BUILDINGS[x].build(this))
		if (this.type && this.owned)
			game.growth[POINT_TYPES[this.type]] += this.totalBonus
	},

	updateText() {
		let s = []
		if (this.key) s.push("⚷\uFE0E" + this.key)
		if (this.lock) s.push((this.keyData.keyPoint.owned || this.unlocked?"🔓\uFE0E":"🔒\uFE0E") + this.lock)
		if (this.exit) s.push("🌟\uFE0E")
		if (this.boss) s.push("⚔\uFE0E")
		if (!this.index) s.push(game && game.skills.mining?"⛏\uFE0E":"🏠\uFE0E")
		this.specialText = s.join("\n")
	},
	
	updateAway() {
		this.away = 0
		let pt = this
		this.locked = (this.lock && !this.unlocked && !this.keyData.keyPoint.owned) ? 1 : 0
		while (!pt.owned && pt.parent && pt.parent != pt) {
			this.away++
			pt = pt.parent
			if (pt.lock && !pt.unlocked && !pt.keyData.keyPoint.owned)
				this.locked = 2
		}
		return this.away
	},
	
	coordinatesOn(position = this.progress || 0, absolute = false) {
		this.temp.x = this.index?this.sdx + (this.edx - this.sdx) * position - (absolute?0:this.x):0
		this.temp.y = this.index?this.sdy + (this.edy - this.sdy) * position - (absolute?0:this.y):0
		return this.temp
	},
	
	getActiveSpirit(slider) {
		return slider.real.spirit * ((this.parent && this.parent.buildings && this.parent.buildings.obelisk)?(this.parent.level || 0) + 1:1)
	},
	
	getActivePower(slider) {
		let currentPower = this.power * this.progress || 0
		
		if (!this.index) {
			let power = Math.max(0, slider.real.power - (slider.clone?0:Math.max(0, ((this.mineDepth || 0) - slider.real.spirit) * 2)))
			return (power) ** 0.6 / 2e3
		}
		
		const chapter = this.map.level > 20 || this.map.virtual ? 1 : 0
		const weak = chapter ? 0 : 0.5
		const strong = chapter ? 1 : 4
		const neutral = chapter ? 0.1 : 1
		const itself = chapter ? -1 : 0
		const phys = chapter ? 0.001 : 1
		
		const spirit = slider.real.spirit//getActiveSpirit(slider)
		let spiritPenalty = (this.boss || slider.clone)?0:Math.max(0,(currentPower - spirit) * 2)
		let fire  = slider.real.fire *  [1,1,1, weak, itself, strong, neutral][this.type]
		let ice   = slider.real.ice *   [1,1,1, neutral, weak, itself, strong][this.type]
		let blood = slider.real.blood * [1,1,1, itself, strong, neutral, weak][this.type]
		let metal = slider.real.metal * [1,1,1, strong, neutral, weak, itself][this.type]
		
		let physical = slider.real.power * (this.type > 2 ? phys : 1)
		let superphysical = 0
		
		let elemental = fire + ice + blood + metal
		let superelemental = 0
		
		if (game.skills.fire ) superelemental += fire , elemental -= fire 
		if (game.skills.ice  ) superelemental += ice  , elemental -= ice  
		if (game.skills.blood) superelemental += blood, elemental -= blood
		if (game.skills.metal) superelemental += metal, elemental -= metal
		if (game.skills.power) superphysical = physical, physical = 0
		
/*		if (this.special == SPECIAL_RESIST && game.skills.pierceResist)
			return physical*/

		elemental = Math.max(0, elemental) * (this.special == SPECIAL_RESIST ? 0 : 1)
		physical = Math.max(0, physical) * (this.special == SPECIAL_BLOCK ? 0 : 1)
		
		superelemental = superelemental * (this.special == SPECIAL_RESIST ? 0 : 1)
		superphysical = superphysical * (this.special == SPECIAL_BLOCK ? 0 : 1)

		return Math.max(0, physical + elemental - spiritPenalty) + superelemental + superphysical
	},
	
	highlight() {
	},
	
	attack(time) {
		if (this.real.loss < 0) {
			this.real.loss = 0
			return
		}
		let power = this.real.loss * time
		if (!this.index) {
			this.mineDepth = (this.mineDepth || 0) + power
			return
		}
		this.progress = this.progress || 0
		const start = this.totalPower * this.progress ** 2
		const end = Math.min(this.totalPower, start + power)
		this.progress = (end / this.totalPower) ** 0.5
		if (this.progress >= 1-1e-9) {
			this.capture()
		}
	},
	
	capture() {
		let attackers = [...this.attackers] //game.sliders.filter(x => x.target == this)

		game.iterations = GAME_ADVANCE_ITERATIONS
		
		game.unlockStory("type_"+POINT_TYPES[this.type])
		if (this.special)
			game.unlockStory("special_"+this.special)

		if (this.exit)
			game.unlockStory("special_star")
		
		if (this.key) 
			game.unlockStory(game.story.special_lock?"special_lock_key":"special_key")
		
		if ([...this.children].filter(x => x.lock).length) 
			game.unlockStory(game.story.special_key?"special_key_lock":"special_lock")

		this.owned = true
		
		if (game.slowMode && this.displays["lowLoad"]) {
			this.displays["lowLoad"].dvDisplay.remove()
			if (gui.target.point == this)
				gui.target.reset()
		}
		
		for (let child of this.children) {
			child.available = true
			if (game.slowMode && (!child.boss || child.boss <= this.map.boss))
				child.getDisplay("lowLoad")
		}
		this.map.updateAways()

		if (gui.target.point == this) {
			if (this.boss || !game.skills.upgradePoints)
				gui.target.reset()
			else
				gui.target.updatePosition()
		}

		if (game.activeRender) {
//			if (slider)
//				animations.Fireworks(this.x, this.y, slider.color, 5 * this.size, this.size * 0.8)
			animations.Fireworks(this.x, this.y, gui.theme.typeColors[this.type], 15 * this.size, this.size)
			
			for (let child of this.children) {
				if (child.boss > this.map.boss) continue
				child.animate(1, 120)
				if (game.skills.sensor)
					for (let grandchild of child.children)
						if ((!grandchild.boss || grandchild.boss <= game.map.boss) && !grandchild.locked)
							grandchild.animate(2, 120)
			}
		}
		
		this.unsuspend()

		game.resources.exp += (this.power * this.length) ** 0.5

		if (this.exit) {
			if (this.map.virtual) {
				game.resources.stardust++
				game.addStatistic("stardust")
			} else {
				game.resources.stars++
				game.addStatistic("stars")
				if (game.resources.stars >= this.map.ascendCost)
					game.unlockStory((this.map.virtual?"v":"m")+this.map.level.digits(3)+"_enough")
			}
		}
		if (this.special == SPECIAL_CLONE) {
			let baseStats = {}
			let sliders = game.sliders.filter(x => !x.clone)
			sliders.map(x => {
				Object.keys(x.stats).map(y => baseStats[y] = (y=="power"?(baseStats[y] || 0) + x.stats[y] / sliders.length:0))
			})
			game.sliders.push(Slider({
				stats : baseStats,
				clone : 1
			}))
			this.special = 0
			game.addStatistic("special_clones")
			game.unlockStory("sc_join")
		}
		if (this.special == SPECIAL_COLONY) {
			game.sliders.push(Slider())
			gui.updateTabs()
			this.special = 0
			let i = this.map.markerIndexes.indexOf(this.index)
			if (i > -1) {
				this.map.markerIndexes.splice(i, 1)
				this.map.markers.splice(i, 1)
			}
			game.unlockStory("s"+game.sliders.filter(x => !x.clone).length.digits(2)+"_join")
		}
		if (this.special == SPECIAL_RESIST) {
			game.addStatistic("special_resists")
		}
		if (this.special == SPECIAL_BLOCK) {
			game.addStatistic("special_blocks")
		}
		if (this.special == SPECIAL_NOCLONE) {
			game.addStatistic("special_noclones")
			this.special = 0
		}
		if (this.special == SPECIAL_NOBUILD) {
			game.addStatistic("special_nobuilds")
			this.special = 0
		}
		game.addStatistic("points")
		
		if (!this.map.points.filter(x => !x.owned).length)
			game.unlockStory((this.map.virtual?"v":"m")+this.map.level.digits(3)+"_full")
		
		game.update()
		attackers.map(x => {
			if (x.clone == 2) {
				const outs = [...this.children].filter(x => !x.locked && (!x.boss || x.boss <= this.map.boss) && x.special != SPECIAL_NOCLONE)
				if (!outs.length)
					x.fullDestroy()
				else
					x.assignTarget(outs[outs.length * Math.random() | 0], true)
			} else {
				x.autoTarget()
				x.getReal(true)
			}
		})
	},

	animate (id, time) {
		this.animating = id
		this.animationTime = time
		this.animationProgress = 0
		game.animatingPoints.add(this)
	},
	
	render(c) {
		if (this.animating == 1) {
			c.save()
			c.translate(this.x, this.y)
			c.beginPath()
			c.strokeStyle = this.map.boss?"gray":"silver"
			const start = this.coordinatesOn(0)
			c.moveTo(start.x, start.y)
			const end = this.coordinatesOn(Math.min(1,this.animationProgress * 1.5))
			c.lineTo(end.x, end.y)
			
			if (this.locked != 1) {
				const arcProgress = Math.min(2 * Math.max(0, this.animationProgress - 0.25),1) * 1.68
				c.moveTo(this.size, 0)
				c.arc(0, 0, this.size, 0, arcProgress)
				c.moveTo(0, this.size)
				c.arc(0, 0, this.size, 1.68, 1.68 + arcProgress)
				c.moveTo(-this.size, 0)
				c.arc(0, 0, this.size, 3.14, 3.14 + arcProgress)
				c.moveTo(0, -this.size)
				c.arc(0, 0, this.size, 4.82, 4.82 + arcProgress)
				c.stroke()
				if (game.skills.sensor && this.animationProgress < 0.5) {
					c.fillStyle = "silver"
					c.globalAlpha = 1 - this.animationProgress * 2
					c.beginPath()
					c.arc(0, 0, this.size * (1 + this.animationProgress), 0, 6.29)
					c.fill()
				}
				if (this.animationProgress > 0.5) {
					c.fillStyle = gui.theme.typeColors[this.type]
					c.globalAlpha = this.animationProgress
					const r = this.size * Math.sin((this.animationProgress - 0.5) * 5) / 0.5985
					c.beginPath()
					c.arc(0, 0, r, 0, 6.29)
					c.fill()
				}
				if (this.progress) {
					c.strokeStyle = "maroon"
					c.beginPath()
					c.globalAlpha = 1
					const start = this.coordinatesOn(0)
					c.moveTo(start.x, start.y)
					const end = this.coordinatesOn(this.progress)
					c.lineTo(end.x, end.y)
					c.stroke()
				}
			} else 
				c.stroke()
			c.restore()
		} else if (this.animating == 2) {
			if (this.animationProgress >= 0.75) {
				c.save()
				c.translate(this.x, this.y)
				c.beginPath()
				c.globalAlpha = this.animateProgress
				c.fillStyle = this.map.boss?"rgb(128,128,225)":"silver"
				const r = this.size * Math.sin((this.animationProgress - 0.75) * 10) / 0.5985
				c.arc(0, 0, r, 0, 6.29)			
				c.fill()
				c.restore()			
			}
		}

		this.animationProgress += 1 / this.animationTime
		if (this.animationProgress >= 1) {
			this.animationProgress = 1
			this.animating = 0
		}
	},

	getReal() {
		if (!this.real) this.real = {}
		this.real.localPower = this.index?(this.progress || 0) * this.power:(this.mineDepth || 0)
		this.real.defence = this.totalPower * (1 - (this.progress || 0) ** 2)
		this.real.passiveDamage = this.real.loss = (this.special != SPECIAL_BLOCK) && !this.locked && (!this.boss || this.boss <= this.map.boss) && this.parent && this.parent.buildings && this.parent.buildings.earthquakeMachine?
			(this.parent.bonus ** 0.78 * game.resources.thunderstone * game.skillCostMult * (this.special == SPECIAL_RESIST?3:1)):0
		if (this.real.loss && !this.owned) game.attacked.add(this)
	},
	
	destroyDisplays() {
		Object.values(this.displays).map(x => x.destroy())
	},
	
	toJSON() {
		let o = Object.assign({}, this)
		delete o.x
		delete o.y
		delete o.dx
		delete o.dy
		delete o.sdx
		delete o.sdy
		delete o.edx
		delete o.edy
		delete o.power
		delete o.renderSize
		delete o.totalPower
		delete o.index
		delete o.parents
		delete o.parent
		delete o.length
		delete o.pathLength
		delete o.children
		delete o.depth
		delete o.available
		delete o.locked
		delete o.away
		delete o.specialText
		delete o.onscreen
		delete o.keyData
		delete o.bonus
		delete o.map
		delete o.real
		delete o.temp
		delete o.outs
		delete o.animating
		delete o.attackers
		delete o.costs
		delete o.manaCosts
		delete o.displays
		delete o.production
		delete o.animationTime
		delete o.animationProgress
		delete o.initialized
		delete o.totalBonus
		delete o.bonusMult
		delete o.noclone
		delete o.nobuild
		if (!o.boss) delete o.boss
		if (!o.exit) delete o.exit
		if (!o.owned) delete o.owned
		return o
	},
}

const Point = Template(pointHandler)