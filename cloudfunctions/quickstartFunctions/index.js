const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const BOARD_SIZE = 15;
const MAX_UNDO_COUNT = 3;

const createEmptyBoard = () =>
  Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(''));

const isBoardSizeValid = (board) =>
  Array.isArray(board) &&
  board.length === BOARD_SIZE &&
  board.every(row => Array.isArray(row) && row.length === BOARD_SIZE);

const normalizeRoomBoardIfNeeded = async (roomId, roomData) => {
  if (!roomData) return roomData;

  const needsBoardFix = !isBoardSizeValid(roomData.board);
  const needsWhiteInfoFix = roomData.whitePlayerInfo === null;
  const needsPendingUndoFix = roomData.pendingUndo === null || typeof roomData.pendingUndo === 'undefined';
  const needsUndoCountsFix = roomData.undoCounts === null || typeof roomData.undoCounts === 'undefined';

  if (!needsBoardFix && !needsWhiteInfoFix && !needsPendingUndoFix && !needsUndoCountsFix) return roomData;

  const updates = {};

  if (needsBoardFix) {
    const normalizedBoard = createEmptyBoard();
    updates.board = normalizedBoard;
    updates.currentPlayer = 'black';
    updates.winner = null;
    updates.status = 'waiting';
    updates.whitePlayer = null;
    updates.whitePlayerInfo = {};
    updates.lastActionAt = new Date();
  } else if (needsWhiteInfoFix) {
    updates.whitePlayerInfo = {};
  }

  if (needsPendingUndoFix) {
    updates.pendingUndo = {};
  }
  if (needsUndoCountsFix) {
    updates.undoCounts = { black: 0, white: 0 };
  }

  await db.collection('gameRooms').doc(roomId).update({ data: updates });

  return {
    ...roomData,
    ...updates
  };
};

// 修复历史房间数据（whitePlayerInfo 为 null 或缺失）
const repairRooms = async () => {
  try {
    await createGameCollection();
    const _ = db.command;
    const query = db.collection('gameRooms').where(
      _.or([
        { whitePlayerInfo: _.eq(null) },
        { whitePlayerInfo: _.exists(false) },
        { pendingUndo: _.eq(null) },
        { pendingUndo: _.exists(false) },
        { undoCounts: _.eq(null) },
        { undoCounts: _.exists(false) }
      ])
    );

    const result = await query.get();
    const rooms = result.data || [];

    if (!rooms.length) {
      return { success: true, repairedCount: 0 };
    }

    let repairedCount = 0;
    for (const room of rooms) {
      try {
        await db.collection('gameRooms').doc(room._id).update({
          data: {
            whitePlayerInfo: room.whitePlayerInfo === null || typeof room.whitePlayerInfo === 'undefined'
              ? {}
              : room.whitePlayerInfo,
            pendingUndo: room.pendingUndo === null || typeof room.pendingUndo === 'undefined'
              ? {}
              : room.pendingUndo,
            undoCounts: room.undoCounts === null || typeof room.undoCounts === 'undefined'
              ? { black: 0, white: 0 }
              : room.undoCounts
          }
        });
        repairedCount++;
      } catch (e) {
        console.error('修复房间失败:', room._id, e);
      }
    }

    return { success: true, repairedCount };
  } catch (e) {
    return { success: false, errMsg: e.message };
  }
};

// 获取 openid
const getOpenId = async () => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

// 获取小程序码
const getMiniProgramCode = async () => {
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/online/index",
  });
  const { buffer } = resp;
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

// 创建游戏房间集合
const createGameCollection = async () => {
  try {
    await db.createCollection("gameRooms");
    return {
      success: true,
      data: "gameRooms collection created",
    };
  } catch (e) {
    return {
      success: true,
      data: "gameRooms collection already exists",
    };
  }
};

// 创建示例集合
const createCollection = async () => {
  try {
    await db.createCollection("sales");
    await db.collection("sales").add({
      data: {
        region: "华东",
        city: "上海",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      data: {
        region: "华东",
        city: "杭州",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      data: {
        region: "华南",
        city: "广州",
        sales: 22,
      },
    });
    await db.collection("sales").add({
      data: {
        region: "华南",
        city: "深圳",
        sales: 22,
      },
    });
    return {
      success: true,
    };
  } catch (e) {
    return {
      success: true,
      data: "create collection success",
    };
  }
};

// 查询示例数据
const selectRecord = async () => {
  return await db.collection("sales").get();
};

// 更新示例数据
const updateRecord = async (event) => {
  try {
    for (let i = 0; i < event.data.length; i++) {
      await db
        .collection("sales")
        .where({
          _id: event.data[i]._id,
        })
        .update({
          data: {
            sales: event.data[i].sales,
          },
        });
    }
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 插入示例数据
const insertRecord = async (event) => {
  try {
    const insertRecord = event.data;
    await db.collection("sales").add({
      data: {
        region: insertRecord.region,
        city: insertRecord.city,
        sales: Number(insertRecord.sales),
      },
    });
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 删除示例数据
const deleteRecord = async (event) => {
  try {
    await db
      .collection("sales")
      .where({
        _id: event.data._id,
      })
      .remove();
    return {
      success: true,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 创建房间
const createRoom = async (event) => {
  try {
    await createGameCollection();
    const wxContext = cloud.getWXContext();
    const { roomName, creatorInfo } = event;
    const creatorNickName = creatorInfo && creatorInfo.nickName ? creatorInfo.nickName : '玩家';
    const trimmedRoomName = roomName && roomName.trim() ? roomName.trim() : '';
    const finalRoomName = trimmedRoomName ? trimmedRoomName.slice(0, 20) : (creatorNickName + '的房间');

    const roomData = {
      name: finalRoomName,
      creatorOpenid: wxContext.OPENID,
      creatorInfo: {
        avatarUrl: creatorInfo?.avatarUrl || '',
        nickName: creatorNickName
      },
      status: 'waiting', // waiting, playing, finished
      board: createEmptyBoard(),
      currentPlayer: 'black',
      blackPlayer: wxContext.OPENID,
      whitePlayer: null,
      whitePlayerInfo: {},
      winner: null,
      moveHistory: [],
      pendingUndo: {},
      undoCounts: { black: 0, white: 0 },
      lastActionType: 'create',
      createdAt: new Date(),
      lastActionAt: new Date()
    };

    const result = await db.collection('gameRooms').add({
      data: roomData
    });

    return {
      success: true,
      roomId: result._id,
      ...roomData
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message
    };
  }
};

// 获取可加入房间列表
const getRoomList = async () => {
  try {
    await createGameCollection();
    const result = await db.collection('gameRooms')
      .where({
        status: 'waiting'
      })
      .orderBy('createdAt', 'desc')
      .get();

    return {
      success: true,
      rooms: result.data
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message
    };
  }
};

// 加入房间
const joinRoom = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const { roomId } = event;

    const room = await db.collection('gameRooms').doc(roomId).get();
    if (!room.data) {
      return {
        success: false,
        errMsg: 'Room not found'
      };
    }

    const normalizedRoom = await normalizeRoomBoardIfNeeded(roomId, room.data);

    if (normalizedRoom.status !== 'waiting') {
      return {
        success: false,
        errMsg: 'Room is full or already in game'
      };
    }

    if (normalizedRoom.creatorOpenid === wxContext.OPENID) {
      return {
        success: false,
        errMsg: 'Cannot join your own room'
      };
    }

    await db.collection('gameRooms').doc(roomId).update({
      data: {
        status: 'playing',
        whitePlayer: wxContext.OPENID,
        whitePlayerInfo: {
          avatarUrl: event.playerInfo?.avatarUrl || '',
          nickName: event.playerInfo?.nickName || '玩家2'
        },
        lastActionType: 'join',
        lastActionAt: new Date()
      }
    });

    return {
      success: true,
      room: { ...normalizedRoom, status: 'playing', whitePlayer: wxContext.OPENID }
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message
    };
  }
};

// 落子
const makeMove = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const { roomId, row, col } = event;

    const room = await db.collection('gameRooms').doc(roomId).get();
    if (!room.data) {
      return {
        success: false,
        errMsg: 'Room not found'
      };
    }

    if (room.data.status !== 'playing') {
      return {
        success: false,
        errMsg: 'Game not started or already finished'
      };
    }

    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      return {
        success: false,
        errMsg: 'Move out of board range'
      };
    }

    const { board, currentPlayer, blackPlayer, whitePlayer } = room.data;

    if ((currentPlayer === 'black' && blackPlayer !== wxContext.OPENID) ||
        (currentPlayer === 'white' && whitePlayer !== wxContext.OPENID)) {
      return {
        success: false,
        errMsg: 'Not your turn'
      };
    }

    if (board[row][col] !== '') {
      return {
        success: false,
        errMsg: 'Cell already occupied'
      };
    }

    const newBoard = board.map(row => [...row]);
    newBoard[row][col] = currentPlayer;
    const nextPlayer = currentPlayer === 'black' ? 'white' : 'black';
    const moveHistory = Array.isArray(room.data.moveHistory) ? room.data.moveHistory : [];
    const nextHistory = moveHistory.concat({
      row,
      col,
      player: currentPlayer,
      ts: new Date()
    });

    const winner = checkWinner(newBoard, row, col);
    const finalStatus = winner ? 'finished' : 'playing';

    await db.collection('gameRooms').doc(roomId).update({
      data: {
        board: newBoard,
        currentPlayer: nextPlayer,
        winner: winner,
        status: finalStatus,
        moveHistory: nextHistory,
        lastActionType: 'move',
        lastActionAt: new Date()
      }
    });

    return {
      success: true,
      board: newBoard,
      currentPlayer: nextPlayer,
      winner,
      status: finalStatus
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message
    };
  }
};

// 胜负判定
const checkWinner = (board, row, col) => {
  const directions = [
    [[0, 1], [0, -1]],
    [[1, 0], [-1, 0]],
    [[1, 1], [-1, -1]],
    [[1, -1], [-1, 1]]
  ];

  const color = board[row][col];

  for (const direction of directions) {
    let count = 1;

    for (const [dx, dy] of direction) {
      let newRow = row + dx;
      let newCol = col + dy;

      while (newRow >= 0 && newRow < BOARD_SIZE &&
             newCol >= 0 && newCol < BOARD_SIZE &&
             board[newRow][newCol] === color) {
        count++;
        newRow += dx;
        newCol += dy;
      }
    }

    if (count >= 5) return color;
  }

  return null;
};

// 获取房间信息
const getRoomInfo = async (event) => {
  try {
    const { roomId } = event;
    const room = await db.collection('gameRooms').doc(roomId).get();

    if (!room.data) {
      return {
        success: false,
        errMsg: 'Room not found'
      };
    }

    const normalizedRoom = await normalizeRoomBoardIfNeeded(roomId, room.data);
    return {
      success: true,
      room: normalizedRoom
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message
    };
  }
};

// 清空所有房间
const clearAllRooms = async () => {
  try {
    console.log('开始清空所有房间...');

    await createGameCollection();

    // 方法1：先获取房间数量，然后批量删除
    const getResult = await db.collection('gameRooms').get();
    const rooms = getResult.data;
    const totalCount = rooms.length;

    console.log(`找到 ${totalCount} 个房间`);

    if (totalCount === 0) {
      return {
        success: true,
        clearedCount: 0
      };
    }

    // 方法2：使用 where 条件批量删除（更高效）
    try {
      const deleteResult = await db.collection('gameRooms').where({
        _id: db.command.exists(true)
      }).remove();

      console.log('批量删除结果:', deleteResult);

      return {
        success: true,
        clearedCount: totalCount
      };
    } catch (batchError) {
      console.log('批量删除失败，改用逐个删除:', batchError.message);

      let deletedCount = 0;
      for (const room of rooms) {
        try {
          await db.collection('gameRooms').doc(room._id).remove();
          deletedCount++;
          console.log(`已删除房间 ${room._id}`);
        } catch (deleteError) {
          if (deleteError.message && deleteError.message.includes('does not exist')) {
            console.log(`房间 ${room._id} 已不存在，跳过`);
            deletedCount++;
          } else {
            console.error(`删除房间 ${room._id} 失败:`, deleteError);
          }
        }
      }

      console.log(`逐个删除完成，成功删除 ${deletedCount} 个房间`);

      return {
        success: true,
        clearedCount: deletedCount
      };
    }
  } catch (e) {
    console.error('清空房间失败:', e);
    return {
      success: false,
      errMsg: `清空失败: ${e.message || e.toString()}`
    };
  }
};

// 关闭房间
const closeRoom = async (event) => {
  try {
    await createGameCollection();
    const wxContext = cloud.getWXContext();
    const { roomId } = event;
    if (!roomId) {
      return {
        success: false,
        errMsg: 'roomId is required'
      };
    }

    const room = await db.collection('gameRooms').doc(roomId).get();
    if (!room.data) {
      return {
        success: true
      };
    }

    const isParticipant =
      room.data.creatorOpenid === wxContext.OPENID ||
      room.data.blackPlayer === wxContext.OPENID ||
      room.data.whitePlayer === wxContext.OPENID;

    if (!isParticipant) {
      return {
        success: false,
        errMsg: 'No permission to close room'
      };
    }

    await db.collection('gameRooms').doc(roomId).remove();

    return {
      success: true
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message
    };
  }
};

// 悔棋申请（联机）
const requestUndo = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const { roomId } = event;
    if (!roomId) {
      return { success: false, errMsg: 'roomId is required' };
    }

    const room = await db.collection('gameRooms').doc(roomId).get();
    if (!room.data) {
      return { success: false, errMsg: 'Room not found' };
    }

    const normalizedRoom = await normalizeRoomBoardIfNeeded(roomId, room.data);
    if (normalizedRoom.status !== 'playing') {
      return { success: false, errMsg: 'Game not in playing status' };
    }

    const { currentPlayer, blackPlayer, whitePlayer } = normalizedRoom;
    const moveHistory = Array.isArray(normalizedRoom.moveHistory) ? normalizedRoom.moveHistory : [];
    if (!moveHistory.length) {
      return { success: false, errMsg: 'No move to undo' };
    }

    const myColor = blackPlayer === wxContext.OPENID
      ? 'black'
      : (whitePlayer === wxContext.OPENID ? 'white' : null);
    if (!myColor) {
      return { success: false, errMsg: 'No permission' };
    }

    const undoCounts = normalizedRoom.undoCounts || { black: 0, white: 0 };
    if ((undoCounts[myColor] || 0) >= MAX_UNDO_COUNT) {
      return { success: false, errMsg: 'Undo limit reached' };
    }

    const lastMove = moveHistory[moveHistory.length - 1];
    if (!lastMove || !lastMove.player) {
      return { success: false, errMsg: 'Invalid move history' };
    }
    if (lastMove.player !== myColor) {
      return { success: false, errMsg: 'Not your last move' };
    }
    if (currentPlayer === myColor) {
      return { success: false, errMsg: 'Not your undo window' };
    }

    if (normalizedRoom.pendingUndo && normalizedRoom.pendingUndo.byOpenid) {
      const pendingMove = normalizedRoom.pendingUndo.move;
      const isSameMove = pendingMove &&
        pendingMove.row === lastMove.row &&
        pendingMove.col === lastMove.col &&
        pendingMove.player === lastMove.player;
      if (isSameMove) {
        return { success: false, errMsg: 'Undo already requested' };
      }
      await db.collection('gameRooms').doc(roomId).update({
        data: {
          pendingUndo: {},
          lastActionType: 'undo_stale_clear',
          lastActionAt: new Date()
        }
      });
    }

    await db.collection('gameRooms').doc(roomId).update({
      data: {
        pendingUndo: {
          byOpenid: wxContext.OPENID,
          byColor: myColor,
          at: new Date(),
          move: lastMove
        },
        lastActionType: 'undo_request',
        lastActionAt: new Date()
      }
    });

    return {
      success: true
    };
  } catch (e) {
    return { success: false, errMsg: e.message };
  }
};

// 悔棋响应（联机）
const respondUndo = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const { roomId, approve } = event;
    if (!roomId) {
      return { success: false, errMsg: 'roomId is required' };
    }

    const room = await db.collection('gameRooms').doc(roomId).get();
    if (!room.data) {
      return { success: false, errMsg: 'Room not found' };
    }

    const normalizedRoom = await normalizeRoomBoardIfNeeded(roomId, room.data);
    if (normalizedRoom.status !== 'playing') {
      return { success: false, errMsg: 'Game not in playing status' };
    }

    const pendingUndo = normalizedRoom.pendingUndo;
    if (!pendingUndo || !pendingUndo.byOpenid) {
      return { success: false, errMsg: 'No pending undo request' };
    }

    const { board, blackPlayer, whitePlayer } = normalizedRoom;
    const myColor = blackPlayer === wxContext.OPENID
      ? 'black'
      : (whitePlayer === wxContext.OPENID ? 'white' : null);
    if (!myColor) {
      return { success: false, errMsg: 'No permission' };
    }

    if (pendingUndo.byOpenid === wxContext.OPENID) {
      return { success: false, errMsg: 'Requester cannot respond' };
    }

    if (!approve) {
      await db.collection('gameRooms').doc(roomId).update({
        data: {
          pendingUndo: {},
          lastActionType: 'undo_reject',
          lastActionAt: new Date()
        }
      });
      return { success: true, rejected: true };
    }

    const moveHistory = Array.isArray(normalizedRoom.moveHistory) ? normalizedRoom.moveHistory : [];
    const lastMove = moveHistory[moveHistory.length - 1];
    if (!lastMove || !lastMove.player) {
      return { success: false, errMsg: 'Invalid move history' };
    }

    if (pendingUndo.move &&
        (pendingUndo.move.row !== lastMove.row ||
         pendingUndo.move.col !== lastMove.col ||
         pendingUndo.move.player !== lastMove.player)) {
      return { success: false, errMsg: 'Move history changed' };
    }

    const newBoard = board.map(row => [...row]);
    if (newBoard[lastMove.row] && newBoard[lastMove.row][lastMove.col] === lastMove.player) {
      newBoard[lastMove.row][lastMove.col] = '';
    }

    const nextHistory = moveHistory.slice(0, -1);
    const undoCounts = normalizedRoom.undoCounts || { black: 0, white: 0 };
    const requesterColor = pendingUndo.byColor;
    if (requesterColor === 'black' || requesterColor === 'white') {
      undoCounts[requesterColor] = (undoCounts[requesterColor] || 0) + 1;
    }

    await db.collection('gameRooms').doc(roomId).update({
      data: {
        board: newBoard,
        currentPlayer: lastMove.player,
        winner: null,
        status: 'playing',
        moveHistory: nextHistory,
        pendingUndo: {},
        undoCounts,
        lastActionType: 'undo',
        lastActionAt: new Date()
      }
    });

    return {
      success: true,
      board: newBoard,
      currentPlayer: lastMove.player,
      winner: null,
      status: 'playing'
    };
  } catch (e) {
    return { success: false, errMsg: e.message };
  }
};

// Cloud function entry
exports.main = async (event, context) => {
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();
    case "getMiniProgramCode":
      return await getMiniProgramCode();
    case "createCollection":
      return await createCollection();
    case "createGameCollection":
      return await createGameCollection();
    case "selectRecord":
      return await selectRecord();
    case "updateRecord":
      return await updateRecord(event);
    case "insertRecord":
      return await insertRecord(event);
    case "deleteRecord":
      return await deleteRecord(event);
    case "createRoom":
      return await createRoom(event);
    case "getRoomList":
      return await getRoomList();
    case "joinRoom":
      return await joinRoom(event);
    case "makeMove":
      return await makeMove(event);
    case "getRoomInfo":
      return await getRoomInfo(event);
    case "closeRoom":
      return await closeRoom(event);
    case "clearAllRooms":
      return await clearAllRooms();
    case "repairRooms":
      return await repairRooms();
    case "requestUndo":
      return await requestUndo(event);
    case "respondUndo":
      return await respondUndo(event);
    default:
      return {
        success: false,
        errMsg: `Unknown type: ${event && event.type ? event.type : 'undefined'}`
      };
  }
};
