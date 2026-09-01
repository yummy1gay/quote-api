const { createCanvas, Image } = require('canvas')

// Original 1x/2x/3x monochrome masks from Telegram Desktop resources:
//   icons/chat/mini_copy[scale].png
//   icons/inline_button_{url,switch,card,web,copy}[scale].png
//   icons/map_point.png + icons/map_point_inner.png
// Telegram's icon compiler treats black as transparent and white as the
// theme colour, so decode the source luminance into an alpha mask here.
const ICON_DATA = {
  'map-point': {
    44: 'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAADB0lEQVRYhdWYQUsqURTH/+OMSYjRom+Qi5ZCG8EWSdBXqKBNH6A+w1tGSFAEUeFArVy0ad2uGAShVkEJEmhIGEImSOXgPW9RRvSqOXfu8b3eHw4InnvP7/w93OuMBYDwH8mR2GRychLz8/PIZDJIJpMYHR0FALRaLVQqFXieh0KhgLOzM4lyoLAxOztLxWKRuCoWizQzMxO63mvoL3Ich/b390kpxYbtSylFBwcH5DjO3wFOJBJUKpW0QT+qVCpRIpEYLLBt2yKw76Ft2x4ccD6fF4Pty3XdwQBPT0+HmtkgKaUom83KA3ueJw7bl+d5ssCpVGpgsH2lUikWcAQMzc3NcdKMtLCwwMpjAU9NTRnBcJTJZFh5LOBkMmkEw9H4+Dgrz8LrIH+np6cnxGIxU6Zv1e12WTVYDne7XWOgIBEF+gaACVytVo1gOLq+vmblsYBPTk6MYDg6PT1l5waefdlsduDnsMZtx7thyuXywGAvLi7YNx1rJABgb2+P/ZPpamdnRyuf1Vk0GqVmsynu7u3tLUUiEXmHfd/H9va2lhMcbW5uQimltYbdXTwep/v7ezF3G40GRaNRnX9qfIcBoNPpYGNjQ8uN75TL5eD7vvY6rQ6Hhoao0WgYu1ur1bRmF2EcBl6u6fX1dW1XPmp1dVV7dvvS7zISoZubm9DuVioVsixLuy50Lo6PsbKyEhp4aWkpLGx4YMuyqFqtasNeXl6awIYHBkDLy8vawIuLi/8OWNflq6srU1j9U+K9iAhra2vsfInTBTDs2LIsqtfrge7W63WTk0HGYeDF5d3d3cA813XZj0GBNU1jZGSEOp3Ol+4+Pj7S2NiYcR1IOAwA7XYbhULhy++Pjo7QbDYlSgEQ6BoATUxMUK/X+9ThdDotUuM1xDai4+PjP2DPz88lYWVGoq/PHnVc15UsAUCwewBUq9Xe3G232xSLxX6uwwCQz+ffPh8eHuL5+Vm6hKzD8XicHh4eSCnFfuerEzaAX5Ld+76P4eFh3N3dYWtrS3JrAMy3lz9JvwEKfuHOtsh9iQAAAABJRU5ErkJggg=='
  },
  'map-point-inner': {
    44: 'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAAz0lEQVRYhe3WMQ6DMBBE0XFaOJ+XW/lW08NZmNopEkoSReySoOyX3CHvEwJDAdBxoW7fBnxagqNLcHQJju6/wWYGkpAESSCJWqvnCACPL93h1Vrre7XWXGY81/FNaq272C0z+x0wybdgki7gsqmPtK4rhmF4eY0kjON4dNR5p0QpxWUfF/CyLG+vmefZYxQAh+fKzK710gEXO9a2NU1TJ9kldUmdpOed9Tslzuy//yXOKMHRJTi6BEeX4OgSHF2Co0twdAmOLsHRJTi6BEd3B9j9qQ/89OQEAAAAAElFTkSuQmCC'
  },
  code: {
    16: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAABGdBTUEAALGPC/xhBQAAAJJJREFUOE+90bEJBCEQheEx2EwEA6uwBAMtxSYsYXKbsSkbEKO3IJzIcHdwwe2X+j8EJXqatTaEkBbvvTwWcs5jDLz03pVSMtqstWOMWqtzTi/XdcnoFEIA4Jxrre1LAMw5mVnWRJRSAqC1Puu9kfX3AQBZPzKIMf42MMaUUohItousT3NOUb9/pY2Zz83Hf/iXGxWw54jvnQ78AAAAAElFTkSuQmCC',
    32: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAABGdBTUEAALGPC/xhBQAAAQBJREFUSEvt1SGOhDAYBeAG0VTigCtUIklNJafpCSjI/04cgUMgSGqxBAErmkyWlylDNzNjlk9B4H+vQFIYu/13QgillDGmO2qapixLvDuW1nocxz1gnmfOOc5cp7Xetg1Tf+n7HmeuE0L4ta/raq2VUhZHWZbhTBSllF+mtRavvYUxxhdIKRljdV1P03R4QUfOOSKK+CRd1/nJoigYY+fpD0SEQSFQgEkBzjkMCvlbwb7vGBRyF7x0F7z08YK2bf1AnucfKaiqalmWYRj8KcaEYdCJNE2TJPHHGBOGKRdhTBhOXuScw6RnIjY7QEQY9kzEdg0450R08hzRP5zbN/0Al0OeDjJuqs8AAAAASUVORK5CYII=',
    48: 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAABGdBTUEAALGPC/xhBQAAAX9JREFUWEft17GqwjAUBmBDQDen+gi2L9BJh45C1r5LniF0EYU+RrFvkM6S5+ioY8kgvUMhtOdWm0OC3Av5xlM9/4+KJKtVEATBf0IIybKsKIqqqqSUzRu32+1wOMA3e5em6f1+7+08Ho/NZgNXeJTnedd1MPajKIrgFl/SNMW2OZ/PcIsvhJDxN/V6vcqyZIwlSRK/sdvt4BaPsiwbtzmdTvAVX1YUhSlUliV8/H1VVZlCjLFhuF6vhRBt25pHn2mtlVKcc0opDMCSUpq9SZIMQyHEJNCalNK1U9M0Zl0cx8PQ/rP5jXMOM1BmC00SkJRSMAPFeyGtNcxA8V6o73uYgRIKLQmFloRCS0KhJaHQkj9XaHwe2u/3w3CyHg9moFwul2HL8/k0Vy2YgAQzULbb7fV6rev6eDyaIUxAmgR4AROQ4Dp3MAEJrnOntYYh1lxPjLOUUjDHmuuZehbnHOZYc711zKKUjv+f7Hm4l71DKeWcK6Vsfk8+b65BELj5AR7WKTbTdE88AAAAAElFTkSuQmCC'
  },
  button: {
    10: 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAACxIAAAsSAdLdfvwAAAB+SURBVChTfc6xDcQgDEBRGjoLyYWnyAgu8CgswQjuWYalWAC5cnRHxCXSKb/0swwh3EJEZhaR4zju80+llDmnfxtjPAwR55ytNSICgBjjg5nZ3Ymo974OmJmqXiwi7g4Ay/bGG7v7xTnnN04p1VpDCP95Z2bbfm/vVHVtrJ+fzsuINlAZ9asAAAAASUVORK5CYII=',
    20: 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAACxIAAAsSAdLdfvwAAADkSURBVDhP3dMxCoMwFAbgh0PI6KZeIaOjZMnoaXICo+O7k0fwEA5CVldxMIUGi/5aSjv2mxLy/7wIkegNKaXW2lrb7ZqmKcsSc1fGmHEcw8U8z0IITB8ZY7Ztw95T3/eYPpJSxpnrujrnlFLFLssyTAOtdRzinMOzj6y1sayUIqK6rqdpOl09BO89M998fNd1MVEUBRFdmy/M/KGMjQPv/e/lEMKflNu2jQd5nn9drqpqWZZhGOIW42dYJqI0TZMkiWuMn2ETYPwM08B7j43dzSMBzIyl3c3zBEIIZob5b3+MrzwAvCggsdyOD5wAAAAASUVORK5CYII=',
    30: 'iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAIAAAC0Ujn1AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAACxIAAAsSAdLdfvwAAAFTSURBVEhL7dUxyoMwGMbxSkC3TvYI6gWc2sFRcPUuOYO4iILHkPYGcZacw1HHkkHsIAR9at7K1+Ub+htTnz9FWj2dDrAsK4qiPM+bphFCtFv3+/16veLmiDAMu66bScMwOI6DS1qaps/nE0t7XNfFMSEMw4PdoihwTLAsa30fpmmq6zpJkiAI/K3L5YJjWhRF624cx3jFn+V5rtN1XePH32iaRqeTJFkObdvOsqzve/3RmlJKSsk5Z4xhbk0IoTdBECyHWZZtYgZCCKretq2+1Pf95dD0fd9xzrGo7aY3a5KUEoval+l5nrGo/dLglwbrf6PnecvhZvoJFrWyLJcrxnHUbxBck7Conc/nqqoej8ftdtOHuCZtch/hmoRjGq5JOKYppTBgoJTCMU1KiQ0D6sm3i3OODQPqeb2LMbb+vZt8eMuYMMY451LK9/t+9N34r70AfJjPD+4YR/QAAAAASUVORK5CYII='
  },
  url: {
    10: 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAABGdBTUEAALGPC/xhBQAAAG9JREFUKFOdy7EJwCAQheFb5nAHl3IOEcEZbDKB3XW2djaHheAkFwiJhpAi5O8eHw/gS1rrWitf9d6NMYsRMca4HTGziJRS7v+zEIKIjDFyzu/mvSeiJ08DgCc756YBQEqJiBa31qy1cyKiUmrxz3bOzEuvMNEBdgAAAABJRU5ErkJggg==',
    20: 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAABGdBTUEAALGPC/xhBQAAALhJREFUOE/Vy7ENgzAQheHDgsoVs7ACdZiCwhOYjvLkwgsgJESBqNN7AUvsYjEBEXKDjji2UiV/ee8+gF+pqqp1XZ/h+r7P85wy37ZtR6y2bSnzLctCf28hImW+oijqun5caprGGJOESYyxaZquMhUTaa1NxUQOw9B1XRK+yyzLkvBbCQBxHJJx/EHGsdY6JAFACOEnKeX1fsYY2/c9JAGAcz6O4zzPZVmS6QwRnXNKqbtM6kv2V70Aglkx4++sIwYAAAAASUVORK5CYII=',
    30: 'iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAIAAAC0Ujn1AAAABGdBTUEAALGPC/xhBQAAARFJREFUSEvt1D2KhDAUwHGDEUHBSi9gZWkjHsAul9AziFcQZEo7L6CVfS6jvVhPY9RdmAGR58cmmXLn3/l8+ZEqivKNL9u2syx78FUURRzHGGOoHDMMo+u6H8EopQghaIGiKILn+PJ9H1og13XneYbnOCKEQOtYkiR93z+vY4xBmJO+CWPcti1UX31E37gf0feuPH3qUkr3nzL0qVvXdRiG+4kwfeWqqhoEwX4oRt+4iqLI0/euPP2nK0nzuDI0pytMn7pN0xxdYbqqqv321X3fOY6zLMu26Xke3NjSdR08p1f33UrTlDG2rmue5/DfPoTQOI787jvTNC3LgtNjhJBhGKZpKsuSxxVO0zQ4+vYf+wWSnLMtuHEJfgAAAABJRU5ErkJggg=='
  },
  switch: {
    10: 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAABGdBTUEAALGPC/xhBQAAAK1JREFUKFN1kCsOhTAQRUc0BVpHWAgrwGNZFr5JDZakpoIUQQgLYCdYHIpLCnmf9uWdZMydI+YOERHiUUpBCBHnv6JnWRZkWfZfLIriFj3zPCNN01CUUqLrOhzH8RY90zS9ZEKe51jXNRC+GYbhEcdxjHcBfd+DqqqK8wBrLRhjIK01zvOEMQZN06AsS+z7fkvOOXDOnzL+trqug+bbtt0lkiT55LHkp23b+Ie4ANYV5bEYlDIKAAAAAElFTkSuQmCC',
    20: 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABGdBTUEAALGPC/xhBQAAAYNJREFUOE+dlMGqgkAUhn2EKCKhCMPMeoDeQGjpwkVC7Vz3GNHCbW/iA0SLaBNBCyEiCouS3LUsqhPjvakzZ+7N+uFfeM4/H+qcGUEQBEhjy7JAVVVU5xgVuH48HnA6naDRaKAeY1Tg+iXf96Fer6P+10Ci4/EItVoNZb4GEh0OB6hWqyj3FpjNZqHb7bK8UPv9HmRZZtdgCHGhUIDhcAjX65XlUNrtdlCpVP4HapoGQRCwa/+U53kgSRIf2Ol04H6/s2vearvdQrlcpoG6rsPtdmOzqbVarWIg+bnn85nNfKTJZBIDR6MR2/9Is9kMMpnMD7DVarH9j7RYLMLxijbFcRw2k1qu60I+n483lrzm5XKhQuQiGI/HMBgMoNfrgWEY3DFaLpcgiiI1JUK73Y4CZIj7/X5ypiKv12sKRp6LxSLKCbZtR4Fms4kDvyaf9lJi5rDJ7hJYLpfDzYTn83kII+eXOWq0N5tNmksTptNpeG0pioJ6lEulEi5ybJom72ZBfgKVj5l83ZmNwwAAAABJRU5ErkJggg==',
    30: 'iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAYAAAA7MK6iAAAABGdBTUEAALGPC/xhBQAAAmxJREFUSEu1lj1oKkEUhbUJaLBVUthYSCwUtLCwsZGgSExQCYgQsLG1s7YIWAuCXbo0GhCxECwEC0MsJAE7QQiIiiRE/EMTf+5j1mfe7tx1neRtDnwgd869h9VxdhQKhQJ+ysnJCZyenqI6I6jAzMvLC2w2G4hEImiNAVRgZqf1eg3X19do/QCowAxfJDwcDiOPBKjADK3VagWhUAj59oAKzIiJhF9dXSGvCKjAzD4tl0sIBoPIT4EKzEiJhPv9ftTDAxUkUavVcHl5Cbe3t3QW0ufnJ1xcXKAZf0EFUTQaDSQSCRiPx/R8SX18fMD5+TmaxxRMdurr6ys9k1kk3Ov10nNx0I6joyNIp9P0nB9psViA2+0+HKxSqaBSqdD9/6X5fA5nZ2f7g8mTlkoluk8WkXCXyyUenM1mab+sGg6HODgWi9E+2dVqtYTBNpuN24G/qU6nAwaDQRhcrVZpn6zq9/tgNBp3edtQstV/U4PBAEwmE/9n3X6o1+u0Vza9vb2B2WwW7CUu2GKx0F7ZRHaw1WqlQ7fByWSS9iN1u12o1WqQy+UglUpBPB6HXq9H2wQajUZgt9vpwH/BzWaTbuH0/v4OmUwGHA4H3cTx9PREt3xpMpns7ePQarV0D0ynU4hGo9wJhhp4PD4+0q2cZrMZOJ1O5BdA3q18NRoN/paXROzvxzsSpbm5uflqIl/roafkUy6XBaHk8PF4PMgnSqFQ4Jry+TwolUpskKBYLH6FktuGz+dDnr202214fn6G4+NjvHiA+/t7LpTcrwKBAFqX5OHhAfR6PV5g4O7u7rt3aT6owIxOp9sd+N/mDzDKGjnDLClnAAAAAElFTkSuQmCC'
  },
  card: {
    10: 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAABGdBTUEAALGPC/xhBQAAADRJREFUKFNjYGBg+E8U3rp1639CAKSGAV0QF2DAsAI3xhDAjtGtwAVooJCY4NmyZQvxngEAzjATfVfkRpwAAAAASUVORK5CYII=',
    20: 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABGdBTUEAALGPC/xhBQAAAFJJREFUOE/tlKENADEMA71e9h8hg6QKeFLDM6n0lo4YHLCiSNKEsYJRVdPdQ7OOdSkh+7Iu3SVNXmijcqygWMG4N6D5hTwPCOPPIf6+7NI5ViAO4UeMeXU4qJAAAAAASUVORK5CYII=',
    30: 'iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAYAAAA7MK6iAAAABGdBTUEAALGPC/xhBQAAAGxJREFUSEvtljEKwDAMxG7K2/3SfMPFq2+OPNQHgqJFFAKJJOUQJihMMJxzMiLy3puvV41qVVP1Qa+aIv60r5rqktoPw3bMOUxQmKAwQWGCoZ82ahvGtmFsG8Y29/QZe+yNPW/t1uAwQWEC4QNOug85Ek2wqgAAAABJRU5ErkJggg=='
  },
  web: {
    10: 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAABGdBTUEAALGPC/xhBQAAAEFJREFUKFO10LERwDAIBEFK/hK+xq/lcns0cmIjK9OGXAKUJOBqAEm1bBNQ39nbyEncJHmy7WpsH8/A32rjsP1bbhqAu4GrAyd8AAAAAElFTkSuQmCC',
    20: 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAABGdBTUEAALGPC/xhBQAAAGJJREFUOE/tlEEKwDAIBPd95hM+er+ztEihB9sSg5cWOkfjgARXAHB3kpK2ApJIujsOM7/XCJ9kLtcgieK0VyQh11Z4g2xm8fszxhg3cu565pc/KJ/BWF2SCEYrkq1j0DlDO8hI7X1REObrAAAAAElFTkSuQmCC',
    30: 'iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAIAAAC0Ujn1AAAABGdBTUEAALGPC/xhBQAAAKNJREFUSEvtls0NwzAIRlmMxfCFYZjgG4otcCs3keIg9ZDY6aHyOxr0hCzxQ/SBmQG4+2sAdwfAzJuzISK11px4l4gQkb3eiMjxMSKi1Q4gR2YAgAb/9xvuTvltHkud+JW61mpmegszS313UpvZ0aPXMbDedlKrak6/gqr2tqVe6sRSJ/5PPXk89Wt34lBta/fBY+HBE4eISikT7cdhtvHEOfkGqvCVNTGPLiMAAAAASUVORK5CYII='
  }
}

const masks = new Map()
const tinted = new Map()

function iconMask (variant, dimension) {
  const sources = ICON_DATA[variant]
  if (!sources) return null
  const sourceSize = sources[dimension]
    ? dimension
    : Object.keys(sources).map(Number).sort((a, b) => a - b).pop()
  const key = `${variant}:${sourceSize}`
  if (masks.has(key)) return masks.get(key)
  const image = new Image()
  image.src = Buffer.from(sources[sourceSize], 'base64')
  const mask = createCanvas(image.width, image.height)
  const ctx = mask.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, mask.width, mask.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const sourceAlpha = pixels.data[index + 3]
    const luminance = Math.max(
      pixels.data[index],
      pixels.data[index + 1],
      pixels.data[index + 2]
    )
    pixels.data[index] = 255
    pixels.data[index + 1] = 255
    pixels.data[index + 2] = 255
    pixels.data[index + 3] = Math.round(sourceAlpha * luminance / 255)
  }
  ctx.clearRect(0, 0, mask.width, mask.height)
  ctx.putImageData(pixels, 0, 0)
  masks.set(key, mask)
  return mask
}

function tintedTDesktopIcon (variant, size, color) {
  const dimension = Math.max(1, Math.round(size))
  const key = `${variant}:${dimension}:${color}`
  if (tinted.has(key)) return tinted.get(key)
  const icon = createCanvas(dimension, dimension)
  const ctx = icon.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const mask = iconMask(variant, dimension)
  if (!mask) return null
  ctx.drawImage(mask, 0, 0, dimension, dimension)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, dimension, dimension)
  tinted.set(key, icon)
  return icon
}

function paintTDesktopIcon (ctx, variant, x, y, size, color) {
  try {
    const icon = tintedTDesktopIcon(variant, size, color)
    if (!icon) return false
    ctx.drawImage(icon, Math.round(x), Math.round(y))
    return true
  } catch (error) {
    console.warn(`Failed to paint Telegram Desktop icon ${variant}:`, error.message)
    return false
  }
}

// history_view_location.cpp places the 44px marker horizontally centred,
// with its bottom tip at the map's centre. The two masks use mapPointDrop
// and mapPointDot from the Desktop palette.
function paintMapPoint (ctx, x, y, width, height, scale = 1) {
  const size = Math.min(44 * scale, width * 0.48, height * 0.86)
  if (size <= 0) return
  const left = x + (width - size) / 2
  const top = y + height / 2 - size
  paintTDesktopIcon(ctx, 'map-point', left, top, size, '#fd4444')
  paintTDesktopIcon(ctx, 'map-point-inner', left, top, size, '#ffffff')
}

// Compatibility name used by code blocks and RichMessage buttons.
const paintCopyIcon = paintTDesktopIcon

module.exports = { paintCopyIcon, paintTDesktopIcon, paintMapPoint }
