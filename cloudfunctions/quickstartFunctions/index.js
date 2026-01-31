const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
// 鑾峰彇openid
const getOpenId = async () => {
  // 鑾峰彇鍩虹淇℃伅
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

// 鑾峰彇灏忕▼搴忎簩缁寸爜
const getMiniProgramCode = async () => {
  // 鑾峰彇灏忕▼搴忎簩缁寸爜鐨刡uffer
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  // 灏嗗浘鐗囦笂浼犱簯瀛樺偍绌洪棿
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

// 鍒涘缓娓告垙鎴块棿闆嗗悎
const createGameCollection = async () => {
  try {
    // 鍒涘缓娓告垙鎴块棿闆嗗悎
    await db.createCollection("gameRooms");
    return {
      success: true,
      data: "gameRooms collection created",
    };
  } catch (e) {
    // 闆嗗悎宸插瓨鍦ㄦ椂涔熻繑鍥炴垚鍔?
    return {
      success: true,
      data: "gameRooms collection already exists",
    };
  }
};

// 鍒涘缓闆嗗悎
const createCollection = async () => {
  try {
    // 鍒涘缓闆嗗悎
    await db.createCollection("sales");
    await db.collection("sales").add({
      // data 瀛楁琛ㄧず闇€鏂板鐨?JSON 鏁版嵁
      data: {
        region: "鍗庝笢",
        city: "涓婃捣",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 瀛楁琛ㄧず闇€鏂板鐨?JSON 鏁版嵁
      data: {
        region: "鍗庝笢",
        city: "鍗椾含",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 瀛楁琛ㄧず闇€鏂板鐨?JSON 鏁版嵁
      data: {
        region: "鍗庡崡",
        city: "骞垮窞",
        sales: 22,
      },
    });
    await db.collection("sales").add({
      // data 瀛楁琛ㄧず闇€鏂板鐨?JSON 鏁版嵁
      data: {
        region: "鍗庡崡",
        city: "娣卞湷",
        sales: 22,
      },
    });
    return {
      success: true,
    };
  } catch (e) {
    // 杩欓噷catch鍒扮殑鏄collection宸茬粡瀛樺湪锛屼粠涓氬姟閫昏緫涓婃潵璇存槸杩愯鎴愬姛鐨勶紝鎵€浠atch杩斿洖success缁欏墠绔紝閬垮厤宸ュ叿鍦ㄥ墠绔姏鍑哄紓甯?
    return {
      success: true,
      data: "create collection success",
    };
  }
};

// 鏌ヨ鏁版嵁
const selectRecord = async () => {
  // 杩斿洖鏁版嵁搴撴煡璇㈢粨鏋?
    return await db.collection("sales").get();
};

// 鏇存柊鏁版嵁
const updateRecord = async (event) => {
  try {
    // 閬嶅巻淇敼鏁版嵁搴撲俊鎭?
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

// 鏂板鏁版嵁
const insertRecord = async (event) => {
  try {
    const insertRecord = event.data;
    // 鎻掑叆鏁版嵁
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

// 鍒犻櫎鏁版嵁
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

// 鍒涘缓娓告垙鎴块棿
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
      board: Array(15).fill(null).map(() => Array(15).fill('')),
      currentPlayer: 'black',
      blackPlayer: wxContext.OPENID,
      whitePlayer: null,
      winner: null,
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

// 鑾峰彇鎴块棿鍒楄〃
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

// Join room
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

    if (room.data.status !== 'waiting') {
      return {
        success: false,
        errMsg: 'Room is full or already in game'
      };
    }

    if (room.data.creatorOpenid === wxContext.OPENID) {
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
          nickName: event.playerInfo?.nickName || 'Player 2'
        },
        lastActionAt: new Date()
      }
    });

    return {
      success: true,
      room: { ...room.data, status: 'playing', whitePlayer: wxContext.OPENID }
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message
    };
  }
};

// Make a move
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

    const winner = checkWinner(newBoard, row, col);
    const finalStatus = winner ? 'finished' : 'playing';

    await db.collection('gameRooms').doc(roomId).update({
      data: {
        board: newBoard,
        currentPlayer: nextPlayer,
        winner: winner,
        status: finalStatus,
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

// 妫€鏌ヨ幏鑳滆€?
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

      while (newRow >= 0 && newRow < 15 && 
             newCol >= 0 && newCol < 15 && 
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

// Get room info
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

    return {
      success: true,
      room: room.data
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message
    };
  }
};

// Clear all rooms
const clearAllRooms = async () => {
  try {
    console.log('开始清空所有房间...');
    
    await createGameCollection();
    
    // 方法1: 先获取房间数量，然后批量删除
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
    
    // 方法2: 使用 where 条件批量删除（更高效）
    try {
      // 尝试批量删除所有房间
      const deleteResult = await db.collection('gameRooms').where({
        _id: db.command.exists(true)
      }).remove();
      
      console.log(`批量删除结果:`, deleteResult);
      
      return {
        success: true,
        clearedCount: totalCount
      };
    } catch (batchError) {
      console.log('批量删除失败，改用逐个删除:', batchError.message);
      
      // 如果批量删除失败，则逐个删除
      let deletedCount = 0;
      for (const room of rooms) {
        try {
          await db.collection('gameRooms').doc(room._id).remove();
          deletedCount++;
          console.log(`已删除房间: ${room._id}`);
        } catch (deleteError) {
          // 忽略文档不存在的错误
          if (deleteError.message && deleteError.message.includes('does not exist')) {
            console.log(`房间 ${room._id} 已不存在，跳过`);
            deletedCount++; // 仍然计数，因为目标已达成
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

// Close room
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

// const getOpenId = require('./getOpenId/index');
// const getMiniProgramCode = require('./getMiniProgramCode/index');
// const createCollection = require('./createCollection/index');
// const selectRecord = require('./selectRecord/index');
// const updateRecord = require('./updateRecord/index');
// const fetchGoodsList = require('./fetchGoodsList/index');
// const genMpQrcode = require('./genMpQrcode/index');
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
  }
};





