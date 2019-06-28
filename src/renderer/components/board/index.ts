import ContentTypes from '../../content-types'

// board in various contexts
import Board from './Board'
import BoardInBoard from './BoardInBoard'
import BoardInList from './BoardInList'

export interface BoardDocCard {
  id: string
  url: string
  x: number
  y: number
  height: number
  width: number
}

export interface BoardDoc {
  title: string
  backgroundColor: string
  cards: BoardDocCard[]
}

ContentTypes.register({
  type: 'board',
  contexts: {
    workspace: Board,
    board: BoardInBoard,
    list: BoardInList },
  name: 'Board',
  icon: 'copy',
})