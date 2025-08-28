import { UFile } from '../utils/ufile'

export const makeBlackSquare32 = (path = 'black-square-32.png') => base64ToPNG(blackSquare32, path)
export const makeRedCircle50 = (path = 'red-circle-50.png') => base64ToPNG(redCircle50, path)
export const makeBlueSquare50 = (path = 'blue-square-50.png') => base64ToPNG(blueSquare50, path)
export const makeGreenRhombus40 = (path = 'green-rhombus-40.png') => base64ToPNG(greenRhombus40, path)

function base64ToPNG(base64String: string, path: string) {
  const byteCharacters = atob(base64String)
  const byteArrays = []
  for (let i = 0; i < byteCharacters.length; i++) byteArrays.push(byteCharacters.charCodeAt(i))

  const byteArray = new Uint8Array(byteArrays)
  return new UFile(new Blob([byteArray], { type: 'image/png' }), { path })
}

const blackSquare32 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAO0lEQVR4AezXwQkAMAgDwND9d27rBD4FOdB3wv1yktzJrwI/f+4UIECAAAECBAgQIECAAAEC+wW63f0AAAD//+3aM8YAAAAGSURBVAMABkQgIT13JVIAAAAASUVORK5CYII='
const redCircle50 = 'iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAADTUlEQVR4AdSZOU/cQBiGDR2ipoV0XCUloNTQhlSRSAMS6fgDSZH8ATqQSBOkVJA2tImAkjIcVQItbVBK8jzWrLXLHuwx7Njoe5nxeOY91muv1zuaRfp7yLJpsAF2wQ/wG/wFDwH2HXOfc5w7HUk+GygIBjX/kfYXhq7APtgCL8ELMA5qZd8x9znHuVeuBXIMFKqvIAgvgkMcav497Rzot1wrh6EO4V3sh6inIIhMgi8InYI1ELvkPFUDTPZC3nUQiDcgvgDr4LlLjYug2ZVWV0Eg3IXN97Tvc7pDKbX2g/aTgh2DQDIGvsPiyUmTpLb0AMY6qbcNEhYes3gFpC49HAdPLb20DcLsb8BLJU0pSi96ammmZRCSe074KrRclHBwJXhrstAUhIlenVKeE00mHw14zuixYbghCCG8du80zCjnxk7wWrhrCMLoJ+Blj6bUpUe9FiaLICT01sAPomJnyTvrwXNuswjC1jaoWhWe8yAk887T+5yqBVkL3ovb+DdVS1DnN/eeHxEGX4GqVu59NBwavxNUNcicGTwiy1VNUOd72SALdQODdFOuXTDIbEoHkbRnDTIViSwlzZRBJlI6iKQ9YRDvWyLxJaMZN0gy9ZjCBrmPSZiI694gd4nEY8reGeQmJmMirhuDXCYSjyl7aZDzmIyJuM4NcpJIPKbsyehIll3D6DNdmkrWhRk8Irpv++DLnSVH7r0W5GvJzXayl3vPg3homHkEqlZHwXvxnd0AVXgwp896FJ7zI+Iekp3RHoCq1EHwnPstguRbWeZveVW499KjXoPtrOGtlY1k2S17iode9Mta28Fr4e/xETHMZ/bugZTVSXuPEHpsmNMUxL1MfEfrr1U0parj4K3JVMsgYZYPvn6GfhkaveippZe2QUj+jxX+alWGI6OHleAJW83VNohTXQhW6ac8ZzwnVvHhC4uV1tUxSG0JJJ4zm2x72aMZSqm1GbSfFOwqiCwQeqXwGfEwPjTVmAuayj+JroPIBPEteEt/CTzHvZmcS2oAP9OQ6a56ClKjROQMvGZ7Bvhb3iDfZ1wrx4ycwFslaHurvoLUJBC9Bh/APGOG8jzywuCl8g9jvs9p8rLvmPuc41zNz7NeDr/g5RP7+fcfAAD//xyO9d8AAAAGSURBVAMAwJqpvxSwEfMAAAAASUVORK5CYII='
const blueSquare50 = 'iVBORw0KGgoAAAANSUhEUgAAABkAAAAZCAYAAADE6YVjAAAAPElEQVR4AezSsQkAAAgDweD+O6srfGEjL9gFAkcq6b7+Lcn5WYKI5ZILCaCw65ILCaCw65ILCaDwn3UNAAAA//+OWGoBAAAABklEQVQDAF5yMgFQsssmAAAAAElFTkSuQmCC'
const greenRhombus40 = 'iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAo0lEQVR4AeySwQnAMAwDTfffOe0A+thUKJgL5COwTO7yVJ2z4X4PqRWHh9ymESMYMRHga5nAjmsxMkZnGsSICey4FiNjdKZBjJjAjmsxMkZnGsSIABuNMBLFL5ZjRECJRhiJ4hfLMSKgRCOMRPGL5RgRUKIRRqL4xXKMCCjRCCNR/GI5RgSUP6N2F0bayMwDGDEDbtdjpI3MPIARM+B2/RojLwAAAP//TYvjhAAAAAZJREFUAwDQj2QBDMkQfwAAAABJRU5ErkJggg=='
